#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path


JSON_PREFIX = '__ASR_JSON__'


def emit(payload):
  sys.stdout.write(JSON_PREFIX + json.dumps(payload, ensure_ascii=False) + '\n')
  sys.stdout.flush()


def emit_error(message, request_id='', code='asr_worker_error'):
  emit({
      'type': 'error',
      'requestId': request_id,
      'code': code,
      'message': message,
  })


def normalize_device_name(requested_device):
  normalized = (requested_device or 'auto').strip().lower()
  if not normalized:
    return 'auto'
  if normalized == 'cuda':
    return 'cuda:0'
  if normalized in ('metal', 'apple', 'apple-silicon'):
    return 'mps'
  return normalized


def has_mps_backend(torch_module):
  try:
    mps = getattr(torch_module.backends, 'mps', None)
    if mps is None:
      return False
    return bool(mps.is_available())
  except Exception:  # pylint: disable=broad-except
    return False


def resolve_device_candidates(requested_device, torch_module):
  normalized = normalize_device_name(requested_device)
  if normalized != 'auto':
    if normalized == 'mps':
      return ['mps', 'cpu']
    return [normalized]

  candidates = []
  if torch_module.cuda.is_available():
    candidates.append('cuda:0')
  if has_mps_backend(torch_module):
    candidates.append('mps')
  candidates.append('cpu')

  seen = set()
  out = []
  for item in candidates:
    if item in seen:
      continue
    seen.add(item)
    out.append(item)
  return out


def read_model_config_text(model_dir):
  try:
    config_path = Path(model_dir) / 'config.yaml'
    if not config_path.exists():
      return ''
    return config_path.read_text(encoding='utf-8', errors='ignore')
  except Exception:  # pylint: disable=broad-except
    return ''


def read_model_json_text(model_dir):
  try:
    config_path = Path(model_dir) / 'config.json'
    if not config_path.exists():
      return ''
    return config_path.read_text(encoding='utf-8', errors='ignore')
  except Exception:  # pylint: disable=broad-except
    return ''


def is_sensevoice_model(model_dir):
  normalized = (model_dir or '').strip().lower()
  if 'sensevoice' in normalized:
    return True
  return 'sensevoice' in read_model_config_text(model_dir).lower()


def is_qwen3_asr_model(model_dir):
  normalized = (model_dir or '').strip().lower()
  if 'qwen3-asr' in normalized:
    return True
  return 'qwen3_asr' in read_model_json_text(model_dir).lower()


def normalize_asr_language(language):
  raw = (language or '').strip()
  normalized = raw.lower()
  if not normalized or normalized == 'auto':
    return 'auto'

  mapping = {
      'chinese': 'zh',
      '中文': 'zh',
      'zh': 'zh',
      'zh-cn': 'zh',
      'english': 'en',
      'en': 'en',
      'japanese': 'ja',
      'ja': 'ja',
      'korean': 'ko',
      'ko': 'ko',
      'cantonese': 'yue',
      'yue': 'yue',
      'nospeech': 'nospeech',
  }
  return mapping.get(normalized, raw)


def normalize_mlx_asr_language(language):
  raw = (language or '').strip()
  normalized = raw.lower()
  if not normalized or normalized == 'auto':
    return 'Chinese'

  mapping = {
      'chinese': 'Chinese',
      '中文': 'Chinese',
      'zh': 'Chinese',
      'zh-cn': 'Chinese',
      'english': 'English',
      'en': 'English',
      'japanese': 'Japanese',
      'ja': 'Japanese',
      'korean': 'Korean',
      'ko': 'Korean',
      'cantonese': 'Cantonese',
      'yue': 'Cantonese',
  }
  return mapping.get(normalized, raw)


def extract_asr_text(result):
  if isinstance(result, list) and result:
    first = result[0]
    if isinstance(first, dict):
      return str(first.get('text', '')).strip()
  if isinstance(result, dict):
    return str(result.get('text', '')).strip()
  return ''


def load_audio_for_sensevoice(audio_path):
  import numpy as np
  import soundfile as sf

  samples, sample_rate = sf.read(audio_path, dtype='float32')
  if samples.ndim > 1:
    samples = np.mean(samples, axis=1)

  target_sample_rate = 16000
  if int(sample_rate) != target_sample_rate:
    try:
      import librosa
      samples = librosa.resample(samples, orig_sr=sample_rate, target_sr=target_sample_rate)
    except Exception as error:  # pylint: disable=broad-except
      raise RuntimeError(
          f'Failed to resample audio from {sample_rate}Hz to {target_sample_rate}Hz: {error}'
      ) from error

  return np.asarray(samples, dtype=np.float32)


def build_model(model_dir, requested_device):
  if is_qwen3_asr_model(model_dir):
    from mlx_audio.stt.utils import load_model

    return load_model(model_dir), 'mlx'

  import torch
  from funasr import AutoModel

  candidates = resolve_device_candidates(requested_device, torch)
  errors = []
  for device in candidates:
    try:
      model = AutoModel(
          model=model_dir,
          device=device,
          disable_update=True,
      )
      return model, device
    except Exception as error:  # pylint: disable=broad-except
      errors.append(f'{device}: {error}')
      if len(candidates) == 1:
        raise

  raise RuntimeError('Failed to initialize ASR model on all devices: ' + '; '.join(errors))


def transcribe_once(model, model_dir, audio_path, language):
  if is_qwen3_asr_model(model_dir):
    result = model.generate(
        audio_path,
        language=normalize_mlx_asr_language(language),
        verbose=False,
    )
    return str(getattr(result, 'text', '')).strip()

  is_sensevoice = is_sensevoice_model(model_dir)
  if is_sensevoice:
    audio_samples = load_audio_for_sensevoice(audio_path)
    result = model.generate(
        input=[audio_samples],
        cache={},
        language=normalize_asr_language(language),
        use_itn=True,
        batch_size_s=30,
    )
    text = extract_asr_text(result)
    if text:
      try:
        from funasr.utils.postprocess_utils import rich_transcription_postprocess
        text = rich_transcription_postprocess(text)
      except Exception:  # pylint: disable=broad-except
        pass
    return text

  result = model.generate(
      input=[audio_path],
      cache={},
      batch_size=1,
      language=language,
      itn=True,
  )
  return extract_asr_text(result)


def parse_args():
  parser = argparse.ArgumentParser(description='Free Agent OpenClaw resident ASR worker')
  parser.add_argument('--model-dir', required=True)
  parser.add_argument('--device', default='auto')
  parser.add_argument('--language', default='auto')
  return parser.parse_args()


def main():
  args = parse_args()
  model_dir = (args.model_dir or '').strip()
  if not model_dir:
    raise ValueError('Missing --model-dir')
  if not Path(model_dir).exists():
    raise ValueError(f'Model directory does not exist: {model_dir}')

  model, device_used = build_model(model_dir, args.device)
  emit({
      'type': 'ready',
      'deviceUsed': device_used,
  })

  for raw in sys.stdin:
    line = (raw or '').strip()
    if not line:
      continue

    request = None
    try:
      request = json.loads(line)
    except Exception:  # pylint: disable=broad-except
      emit_error('Invalid JSON request payload.', code='invalid_request')
      continue

    request_type = str(request.get('type', '')).strip().lower()
    request_id = str(request.get('requestId', '')).strip()

    if request_type == 'shutdown':
      emit({
          'type': 'shutdown-ack',
      })
      return

    if request_type != 'transcribe':
      emit_error('Unsupported request type.', request_id=request_id, code='unsupported_request')
      continue

    audio_path = str(request.get('audioPath', '')).strip()
    if not audio_path:
      emit_error('Missing audioPath.', request_id=request_id, code='missing_audio_path')
      continue
    if not Path(audio_path).exists():
      emit_error(
          f'Audio file does not exist: {audio_path}',
          request_id=request_id,
          code='audio_path_missing',
      )
      continue

    language = str(request.get('language', '')).strip() or args.language
    try:
      text = transcribe_once(model, model_dir, audio_path, language)
      emit({
          'type': 'result',
          'requestId': request_id,
          'text': text,
          'deviceUsed': device_used,
      })
    except Exception as error:  # pylint: disable=broad-except
      emit_error(str(error), request_id=request_id, code='transcribe_failed')


if __name__ == '__main__':
  try:
    main()
  except Exception as error:  # pylint: disable=broad-except
    emit_error(str(error), code='worker_bootstrap_failed')
    raise SystemExit(1)

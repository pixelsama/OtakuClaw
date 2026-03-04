#!/usr/bin/env python3
import argparse
import base64
import json
import sys
from pathlib import Path


def emit(payload, exit_code=0):
  sys.stdout.write(json.dumps(payload, ensure_ascii=False))
  sys.stdout.flush()
  raise SystemExit(exit_code)


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
  # preserve order, remove duplicates
  seen = set()
  out = []
  for item in candidates:
    if item in seen:
      continue
    seen.add(item)
    out.append(item)
  return out


def select_dtype_for_device(torch_module, device):
  if device.startswith('cuda'):
    return torch_module.bfloat16
  if device == 'mps':
    # float16 is usually faster and better supported than bfloat16 on MPS.
    return torch_module.float16
  return torch_module.float32


def read_model_config_text(model_dir):
  try:
    config_path = Path(model_dir) / 'config.yaml'
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
      sample_rate = target_sample_rate
    except Exception as error:  # pylint: disable=broad-except
      raise RuntimeError(
          f'Failed to resample audio from {sample_rate}Hz to {target_sample_rate}Hz: {error}'
      ) from error

  return np.asarray(samples, dtype=np.float32)


def run_asr_once(args, device):
  from funasr import AutoModel

  is_sensevoice = is_sensevoice_model(args.model_dir)
  model = AutoModel(
      model=args.model_dir,
      device=device,
  )

  if is_sensevoice:
    audio_samples = load_audio_for_sensevoice(args.audio_path)
    result = model.generate(
        input=[audio_samples],
        cache={},
        language=normalize_asr_language(args.language),
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
      input=[args.audio_path],
      cache={},
      batch_size=1,
      language=args.language,
      itn=True,
  )

  return extract_asr_text(result)


def run_asr(args):
  import torch

  candidates = resolve_device_candidates(args.device, torch)
  errors = []
  for device in candidates:
    try:
      text = run_asr_once(args, device)
      return {
          'text': text,
          'deviceUsed': device,
      }
    except Exception as error:  # pylint: disable=broad-except
      errors.append(f'{device}: {error}')
      # We only retry when there are fallback candidates.
      if len(candidates) == 1:
        raise

  raise RuntimeError('ASR failed on all candidate devices: ' + '; '.join(errors))


def run_tts_once(args, device):
  import numpy as np
  import torch
  from qwen_tts import Qwen3TTSModel

  dtype = select_dtype_for_device(torch, device)
  model = Qwen3TTSModel.from_pretrained(
      args.model_dir,
      device_map=device,
      dtype=dtype,
  )

  tts_mode = (args.tts_mode or 'custom_voice').strip().lower()
  language = args.language or 'Chinese'

  if tts_mode == 'voice_design':
    wavs, sample_rate = model.generate_voice_design(
        text=args.text,
        language=language,
        instruct=args.instruct or '',
    )
  else:
    wavs, sample_rate = model.generate_custom_voice(
        text=args.text,
        language=language,
        speaker=args.speaker or 'Vivian',
        instruct=args.instruct or '',
    )

  if not wavs:
    return {
        'sampleRate': int(sample_rate),
        'pcmS16LeBase64': '',
    }

  wav = np.asarray(wavs[0], dtype=np.float32)
  wav = np.clip(wav, -1.0, 1.0)
  pcm = (wav * 32767.0).astype(np.int16).tobytes()

  return {
      'sampleRate': int(sample_rate),
      'pcmS16LeBase64': base64.b64encode(pcm).decode('ascii'),
  }


def run_tts(args):
  import torch

  candidates = resolve_device_candidates(args.device, torch)
  errors = []
  for device in candidates:
    try:
      payload = run_tts_once(args, device)
      payload['deviceUsed'] = device
      return payload
    except Exception as error:  # pylint: disable=broad-except
      errors.append(f'{device}: {error}')
      if len(candidates) == 1:
        raise

  raise RuntimeError('TTS failed on all candidate devices: ' + '; '.join(errors))


def parse_args():
  parser = argparse.ArgumentParser(description='Free Agent OpenClaw Python voice bridge')
  parser.add_argument('--task', required=True, choices=['asr', 'tts'])
  parser.add_argument('--device', default='auto')

  parser.add_argument('--model-dir')
  parser.add_argument('--tokenizer-dir')

  parser.add_argument('--audio-path')
  parser.add_argument('--language', default='auto')

  parser.add_argument('--text')
  parser.add_argument('--tts-mode', default='custom_voice')
  parser.add_argument('--speaker', default='Vivian')
  parser.add_argument('--instruct', default='')

  return parser.parse_args()


def validate_args(args):
  model_dir = (args.model_dir or '').strip()
  if not model_dir:
    raise ValueError('Missing --model-dir')
  if not Path(model_dir).exists():
    raise ValueError(f'Model directory does not exist: {model_dir}')

  if args.task == 'asr':
    audio_path = (args.audio_path or '').strip()
    if not audio_path:
      raise ValueError('Missing --audio-path')
    if not Path(audio_path).exists():
      raise ValueError(f'Audio file does not exist: {audio_path}')

  if args.task == 'tts':
    text = (args.text or '').strip()
    if not text:
      raise ValueError('Missing --text')


def main():
  args = parse_args()
  try:
    validate_args(args)

    if args.task == 'asr':
      payload = run_asr(args)
    elif args.task == 'tts':
      payload = run_tts(args)
    else:
      raise ValueError(f'Unsupported task: {args.task}')

    emit(payload)
  except Exception as error:  # pylint: disable=broad-except
    sys.stderr.write(f'{type(error).__name__}: {error}\n')
    sys.stderr.flush()
    raise SystemExit(1)


if __name__ == '__main__':
  main()

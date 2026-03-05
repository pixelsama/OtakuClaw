#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path


def download_via_hf(repo_id, local_dir):
  from huggingface_hub import snapshot_download

  snapshot_download(
      repo_id=repo_id,
      local_dir=local_dir,
      local_dir_use_symlinks=False,
      resume_download=True,
  )
  return 'huggingface'


def download_via_modelscope(model_id, local_dir):
  from modelscope.hub.snapshot_download import snapshot_download

  snapshot_download(model_id=model_id, local_dir=local_dir)
  return 'modelscope'


def download_model(model_id, local_dir, source='auto'):
  errors = []
  normalized_source = (source or 'auto').strip().lower()

  if normalized_source in ('auto', 'huggingface'):
    try:
      return download_via_hf(model_id, local_dir)
    except Exception as error:  # pylint: disable=broad-except
      errors.append(f'huggingface: {error}')
      if normalized_source == 'huggingface':
        raise

  if normalized_source in ('auto', 'modelscope'):
    try:
      return download_via_modelscope(model_id, local_dir)
    except Exception as error:  # pylint: disable=broad-except
      errors.append(f'modelscope: {error}')
      if normalized_source == 'modelscope':
        raise

  raise RuntimeError('; '.join(errors) if errors else 'no download source succeeded')


def parse_args():
  parser = argparse.ArgumentParser(description='Bootstrap Python runtime for OpenClaw voice stack')
  parser.add_argument('--asr-model-id', default='')
  parser.add_argument('--tts-model-id', default='')
  parser.add_argument('--tts-tokenizer-model-id', default='')

  parser.add_argument('--asr-model-dir', default='')
  parser.add_argument('--tts-model-dir', default='')
  parser.add_argument('--tts-tokenizer-dir', default='')

  parser.add_argument('--source', default='auto', choices=['auto', 'huggingface', 'modelscope'])

  return parser.parse_args()


def main():
  args = parse_args()

  has_asr = bool((args.asr_model_id or '').strip())
  has_tts = bool((args.tts_model_id or '').strip())
  if not has_asr and not has_tts:
    raise SystemExit('--asr-model-id or --tts-model-id is required')
  if has_asr and not (args.asr_model_dir or '').strip():
    raise SystemExit('--asr-model-dir is required when --asr-model-id is set')
  if has_tts and not (args.tts_model_dir or '').strip():
    raise SystemExit('--tts-model-dir is required when --tts-model-id is set')

  asr_dir = Path(args.asr_model_dir) if has_asr else None
  tts_dir = Path(args.tts_model_dir) if has_tts else None
  tokenizer_dir = Path(args.tts_tokenizer_dir) if args.tts_tokenizer_dir else None

  if asr_dir:
    asr_dir.mkdir(parents=True, exist_ok=True)
  if tts_dir:
    tts_dir.mkdir(parents=True, exist_ok=True)
  if tokenizer_dir and has_tts:
    tokenizer_dir.mkdir(parents=True, exist_ok=True)

  try:
    asr_source = download_model(args.asr_model_id, str(asr_dir), args.source) if has_asr else ''
    tts_source = download_model(args.tts_model_id, str(tts_dir), args.source) if has_tts else ''

    tokenizer_source = ''
    if has_tts and args.tts_tokenizer_model_id and tokenizer_dir:
      tokenizer_source = download_model(args.tts_tokenizer_model_id, str(tokenizer_dir), args.source)

    payload = {
        'asrModelDir': str(asr_dir) if asr_dir else '',
        'ttsModelDir': str(tts_dir) if tts_dir else '',
        'ttsTokenizerDir': str(tokenizer_dir) if (tokenizer_dir and has_tts) else '',
        'source': {
            'asr': asr_source,
            'tts': tts_source,
            'ttsTokenizer': tokenizer_source,
        },
    }
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.flush()
  except Exception as error:  # pylint: disable=broad-except
    sys.stderr.write(f'{type(error).__name__}: {error}\n')
    sys.stderr.flush()
    raise SystemExit(1)


if __name__ == '__main__':
  main()

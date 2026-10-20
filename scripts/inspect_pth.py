#!/usr/bin/env python3
"""Inspect a voice-model checkpoint (.pth/.pt/.ckpt) and report what framework it belongs to and
what else is needed to run inference. Does NOT load the model into a network — it only reads the
checkpoint structure, so it is safe to run on any file.

Usage:
    python3 scripts/inspect_pth.py /path/to/G_10000.pth [--config /path/to/config.json]

Requires torch (CPU is fine):  pip install torch  — or run inside svc_service/.venv.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def human(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}TB"


def load_checkpoint(path: Path):
    try:
        import torch
    except ImportError:
        print("✗ torch is not installed. Install with:  pip install torch   (or use svc_service/.venv)")
        sys.exit(2)
    try:
        return torch.load(path, map_location="cpu", weights_only=True)
    except Exception as e:  # noqa: BLE001 - old pickles may need weights_only=False
        print(f"  (weights_only load failed: {e.__class__.__name__}; retrying with weights_only=False — only do this for files you trust)")
        return torch.load(path, map_location="cpu", weights_only=False)


def classify(keys: list[str], top: dict) -> tuple[str, list[str]]:
    """Return (framework guess, evidence)."""
    ev: list[str] = []
    k = set(keys)
    joined = " ".join(keys)

    def has(prefix: str) -> bool:
        return any(x.startswith(prefix) for x in keys)

    # RVC: dict with 'weight', 'config', 'sr', 'f0', 'version'
    if {"weight", "config"} <= set(top.keys()) and ("sr" in top or "f0" in top):
        ev.append("top-level keys weight/config/sr/f0 → RVC export format")
        return f"RVC (Retrieval-based VC) {top.get('version', '')} sr={top.get('sr')} f0={top.get('f0')}", ev
    if has("enc_p.") and has("dec.") and has("flow."):
        if "emb_g.weight" in k:
            ev.append("emb_g.weight (speaker embedding) present")
        if has("enc_p.f0_emb") or "enc_p.f0_emb.weight" in k:
            ev.append("enc_p.f0_emb → so-vits-svc 4.x generator")
        if has("enc_p.uv_emb") or "enc_p.emb_uv.weight" in k or has("enc_p.emb_uv"):
            ev.append("uv embedding → so-vits-svc 4.x")
        if "enc_p.pre.weight" in k:
            w = top.get("enc_p.pre.weight")
            if w is not None and hasattr(w, "shape"):
                ev.append(f"enc_p.pre.weight shape {tuple(w.shape)} → speech-encoder dim {w.shape[1]} "
                          f"({'ContentVec/HuBERT-768 (vec768l12)' if w.shape[1] == 768 else 'hubert-soft-256 (vec256l9 / 4.0 default)' if w.shape[1] == 256 else 'other'})")
        if has("dec.m_source") or has("dec.noise_convs"):
            ev.append("NSF-HiFiGAN decoder (dec.m_source / noise_convs)")
        if has("enc_p.encoder.attn_layers") and has("enc_q."):
            ev.append("VITS-style posterior encoder enc_q + flow")
        if any("f0_decoder" in x for x in keys):
            ev.append("f0_decoder present → so-vits-svc 4.1 (F0 predictor, 'vol_embedding' models)")
        return "so-vits-svc 4.x Generator (G_*.pth)", ev
    if has("mpd.") or has("msd.") or (has("discriminators.") and not has("dec.")):
        return "so-vits-svc / VITS Discriminator (D_*.pth) — NOT usable for inference, you need the G_ file", ev
    if "enc_p.emb.weight" in k and has("dec.") and not has("enc_p.f0_emb"):
        return "VITS TTS (text-to-speech) generator — not a voice-conversion model", ev
    if has("ssl_proj") or has("quantizer") or has("vq_model"):
        return "GPT-SoVITS (SoVITS stage) — different pipeline than so-vits-svc", ev
    if has("hubert.") or has("feature_extractor.") or "encoder.layers.0.self_attn.k_proj.weight" in k:
        return "HuBERT/ContentVec speech encoder checkpoint — this is a dependency, not the voice model", ev
    if "model" in top and isinstance(top["model"], dict):
        return "wrapped checkpoint ({'model': state_dict}) — see inner keys below", ev
    if "generator" in top and isinstance(top["generator"], dict):
        return "NSF-HiFiGAN vocoder checkpoint ('generator') — dependency for DDSP/so-vits 4.1, not the voice model", ev
    return "unknown / unrecognised architecture", [f"first keys: {keys[:8]}"] + ([f"text: {joined[:200]}"] if len(joined) < 200 else [])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--config", help="path to config.json (so-vits-svc) to cross-check", default=None)
    args = ap.parse_args()
    path = Path(args.path).expanduser()
    if not path.exists():
        print(f"✗ file not found: {path}")
        return 1
    print(f"File: {path}  ({human(path.stat().st_size)})")
    ckpt = load_checkpoint(path)
    top = ckpt if isinstance(ckpt, dict) else {}
    print(f"Top-level type: {type(ckpt).__name__}; keys: {list(top.keys())[:12]}{' …' if len(top) > 12 else ''}")

    state = None
    for key in ("model", "state_dict", "generator", "weight", "net_g"):
        if isinstance(top.get(key), dict):
            state = top[key]
            print(f"State dict found under '{key}' with {len(state)} tensors")
            break
    if state is None:
        state = {k: v for k, v in top.items() if hasattr(v, "shape")}
        if state:
            print(f"Flat state dict with {len(state)} tensors")
    keys = list(state.keys()) if state else list(top.keys())
    for meta in ("iteration", "learning_rate", "epoch", "version", "sr", "f0", "info"):
        if meta in top and not hasattr(top[meta], "shape"):
            print(f"  {meta}: {top[meta]}")
    n_params = sum(int(v.numel()) for v in (state or {}).values() if hasattr(v, "numel"))
    if n_params:
        print(f"Parameters: {n_params/1e6:.1f}M")

    kind, evidence = classify(keys, {**top, **(state or {})})
    print(f"\n→ Framework guess: {kind}")
    for e in evidence:
        print(f"   • {e}")

    # Speaker count from emb_g
    emb = (state or {}).get("emb_g.weight")
    if emb is not None and hasattr(emb, "shape"):
        print(f"   • speakers (emb_g rows): {emb.shape[0]}, gin_channels={emb.shape[1]}")

    if "so-vits-svc" in kind and "Generator" in kind:
        print("\nRequired alongside this G_*.pth for so-vits-svc 4.x inference:")
        print("   1. config.json from the SAME training run (sample rate, hop_length, speaker map, ssl_dim, n_speakers…)")
        print("   2. Speech encoder checkpoint (NOT in the repo, download separately):")
        print("        - vec768l12 (so-vits-svc 4.1 default): ContentVec  checkpoint_best_legacy_500.pt  → pretrain/")
        print("        - vec256l9 / hubert-soft (4.0 default): hubert-soft-0d54a1f4.pt → hubert/")
        print("      so-vits-svc-fork downloads these automatically on first run.")
        print("   3. Optional: F0 predictor — crepe/rmvpe/dio/harvest (rmvpe needs rmvpe.pt; dio/harvest need no file)")
        print("   4. Optional (4.1 only, if config enables it): NSF-HiFiGAN vocoder for shallow diffusion / enhancer")
        print("\nRecommended runner: svc_service/ (so-vits-svc-fork, Python 3.10/3.11). See svc_service/README.md")
        print("Mac note: so-vits-svc-fork infers on CPU or Apple MPS (device auto-detect); expect ~1–3× realtime on M1/M2 CPU.")

    if args.config:
        cfg = json.loads(Path(args.config).read_text())
        d, m = cfg.get("data", {}), cfg.get("model", {})
        print(f"\nconfig.json: sampling_rate={d.get('sampling_rate')} hop_length={d.get('hop_length')} "
              f"ssl_dim={m.get('ssl_dim')} n_speakers={m.get('n_speakers')} speech_encoder={m.get('speech_encoder')} "
              f"spk={list(cfg.get('spk', {}).keys())}")
        pre = (state or {}).get("enc_p.pre.weight")
        if pre is not None and m.get("ssl_dim") and pre.shape[1] != m["ssl_dim"]:
            print(f"   ✗ MISMATCH: checkpoint speech-encoder dim {pre.shape[1]} ≠ config ssl_dim {m['ssl_dim']}")
        else:
            print("   ✓ config appears to match the checkpoint")
    return 0


if __name__ == "__main__":
    sys.exit(main())

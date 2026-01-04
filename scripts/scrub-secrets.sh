#!/bin/bash
# scrub-secrets.sh - Security scrubbing for context injection
# Version: 1.0
# Part of Outpost Context Injection System

set -euo pipefail

# Input from stdin or file
INPUT="${1:-/dev/stdin}"

# Expanded pattern list per fleet review
# Each pattern replaces matches with [REDACTED]

sed -E \
    -e 's/github_pat_[A-Za-z0-9_]+/[REDACTED]/g' \
    -e 's/ghp_[A-Za-z0-9]+/[REDACTED]/g' \
    -e 's/gho_[A-Za-z0-9]+/[REDACTED]/g' \
    -e 's/ghu_[A-Za-z0-9]+/[REDACTED]/g' \
    -e 's/AKIA[A-Z0-9]{16}/[REDACTED]/g' \
    -e 's/ASIA[A-Z0-9]{16}/[REDACTED]/g' \
    -e 's/sk-[A-Za-z0-9]{32,}/[REDACTED]/g' \
    -e 's/sk-ant-[A-Za-z0-9-]+/[REDACTED]/g' \
    -e 's/xoxb-[A-Za-z0-9-]+/[REDACTED]/g' \
    -e 's/xoxp-[A-Za-z0-9-]+/[REDACTED]/g' \
    -e 's/xoxa-[A-Za-z0-9-]+/[REDACTED]/g' \
    -e 's/-----BEGIN [A-Z ]*KEY-----/[REDACTED_PEM]/g' \
    -e 's/-----BEGIN CERTIFICATE-----/[REDACTED_CERT]/g' \
    -e 's/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/[REDACTED_JWT]/g' \
    "$INPUT"

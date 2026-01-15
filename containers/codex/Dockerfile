# =============================================================================
# Outpost v2 OpenAI Codex Agent Container
# =============================================================================
# Extends outpost-base with OpenAI Codex CLI for autonomous code generation
# Model: gpt-5.2-codex (default), gpt-4o-codex
# =============================================================================

# Configurable base image for local/ECR builds
ARG BASE_IMAGE=outpost-base:latest
FROM ${BASE_IMAGE}

# -----------------------------------------------------------------------------
# Image Metadata
# -----------------------------------------------------------------------------
LABEL maintainer="Zero Echelon <platform@zeroechelon.com>" \
      org.opencontainers.image.title="Outpost v2 Codex Agent" \
      org.opencontainers.image.description="OpenAI Codex agent for Outpost multi-agent execution platform" \
      org.opencontainers.image.version="2.0.0" \
      org.opencontainers.image.vendor="Zero Echelon" \
      org.opencontainers.image.source="https://github.com/rgsuarez/outpost" \
      org.opencontainers.image.licenses="Proprietary" \
      ai.outpost.agent="codex" \
      ai.outpost.agent.provider="openai" \
      ai.outpost.agent.models="gpt-5.2-codex,gpt-4o-codex" \
      ai.outpost.agent.capabilities="code-generation,code-review,refactoring,autonomous-execution"

# -----------------------------------------------------------------------------
# Environment Configuration
# -----------------------------------------------------------------------------
# Agent identification
ENV OUTPOST_AGENT=codex \
    OUTPOST_AGENT_PROVIDER=openai \
    # Default model (can be overridden at runtime)
    CODEX_DEFAULT_MODEL=gpt-5.2-codex \
    # Codex CLI configuration
    CODEX_DATA_DIR=/home/outpost/.codex \
    # Sandbox configuration for safe code execution
    CODEX_SANDBOX_MODE=enabled \
    CODEX_SANDBOX_NETWORK=restricted \
    # Yolo mode disabled by default (enable with --yolo flag)
    CODEX_YOLO_MODE=false \
    # Workspace configuration
    CODEX_WORKSPACE=/workspace

# -----------------------------------------------------------------------------
# Install OpenAI Codex CLI
# -----------------------------------------------------------------------------
# Switch to root for package installation
USER root

# Create agent directories
RUN mkdir -p /opt/agents/codex \
    && mkdir -p /home/outpost/.codex \
    && chown -R outpost:outpost /opt/agents/codex \
    && chown -R outpost:outpost /home/outpost/.codex

# Switch back to outpost user for npm install
USER outpost

# Install OpenAI Codex CLI globally
RUN npm install -g @openai/codex \
    && npm cache clean --force

# Verify Codex installation
RUN codex --version || echo "Codex CLI installed (version check may require API key)"

# -----------------------------------------------------------------------------
# Agent Initialization Script
# -----------------------------------------------------------------------------
# Copy init script (created inline to avoid COPY context issues)
USER root
COPY --chown=outpost:outpost init.sh /opt/agents/codex/init.sh
RUN chmod +x /opt/agents/codex/init.sh

# -----------------------------------------------------------------------------
# Entrypoint Configuration
# -----------------------------------------------------------------------------
# Create agent-specific entrypoint that sources init script
RUN printf '#!/bin/bash\nset -e\nsource /opt/agents/codex/init.sh\nexec "$@"\n' > /entrypoint.sh \
    && chmod +x /entrypoint.sh

# Switch to non-root user for runtime
USER outpost

# Set working directory
WORKDIR /workspace

# Default command runs Codex in interactive mode
CMD ["codex"]

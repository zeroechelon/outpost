# =============================================================================
# Outpost v2 Gemini Agent Container
# =============================================================================
# Google Gemini CLI agent for autonomous code execution
# Extends outpost-base with Gemini-specific tooling
# =============================================================================

# Configurable base image (local build vs ECR)
ARG BASE_IMAGE=outpost-base:latest
FROM ${BASE_IMAGE}

# -----------------------------------------------------------------------------
# Image Metadata
# -----------------------------------------------------------------------------
LABEL maintainer="Zero Echelon <platform@zeroechelon.com>" \
      org.opencontainers.image.title="Outpost v2 Gemini Agent" \
      org.opencontainers.image.description="Google Gemini CLI agent for Outpost multi-agent execution platform" \
      org.opencontainers.image.version="2.0.0" \
      org.opencontainers.image.vendor="Zero Echelon" \
      org.opencontainers.image.source="https://github.com/rgsuarez/outpost" \
      org.opencontainers.image.licenses="Proprietary" \
      outpost.agent.name="gemini" \
      outpost.agent.cli="gemini" \
      outpost.agent.package="@google/gemini-cli" \
      outpost.agent.models="gemini-3-pro-preview,gemini-3-flash"

# -----------------------------------------------------------------------------
# Install Gemini CLI
# -----------------------------------------------------------------------------
# Install globally via npm (runs as outpost user, uses npm-global prefix from base)
RUN npm install -g @google/gemini-cli \
    && gemini --version

# -----------------------------------------------------------------------------
# Create Agent Directory Structure
# -----------------------------------------------------------------------------
USER root
RUN mkdir -p /opt/agents/gemini \
    && chown -R outpost:outpost /opt/agents/gemini
USER outpost

# -----------------------------------------------------------------------------
# Copy Agent Initialization Script
# -----------------------------------------------------------------------------
COPY --chown=outpost:outpost init.sh /opt/agents/gemini/init.sh
RUN chmod +x /opt/agents/gemini/init.sh

# -----------------------------------------------------------------------------
# Environment Configuration
# -----------------------------------------------------------------------------
# Agent identification
ENV OUTPOST_AGENT=gemini \
    OUTPOST_AGENT_CLI=gemini \
    OUTPOST_AGENT_PACKAGE="@google/gemini-cli"

# Default model (can be overridden at runtime)
ENV MODEL_ID=gemini-3-pro-preview

# Gemini CLI configuration
# GOOGLE_API_KEY must be provided at runtime (never hardcode!)
# YOLO mode allows autonomous execution without confirmation prompts
ENV GEMINI_YOLO_MODE=true \
    GEMINI_NON_INTERACTIVE=true

# Supported models for reference (used by orchestrator)
ENV GEMINI_SUPPORTED_MODELS="gemini-3-pro-preview,gemini-3-flash"

# -----------------------------------------------------------------------------
# Entrypoint Configuration
# -----------------------------------------------------------------------------
# Override base entrypoint to source agent init script
COPY --chown=outpost:outpost entrypoint.sh /entrypoint.sh
USER root
RUN chmod +x /entrypoint.sh
USER outpost

# Working directory
WORKDIR /workspace

# Default command (execute Gemini CLI)
CMD ["gemini"]

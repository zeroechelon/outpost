# =============================================================================
# Outpost v2 Claude Code Agent Container
# =============================================================================
# Extends base image with Claude Code CLI for AI-assisted development
# Supports: claude-opus-4-5, claude-sonnet-4-5, claude-haiku-4-5
# =============================================================================

# Configurable base image (local vs ECR)
ARG BASE_IMAGE=outpost-base:latest
FROM ${BASE_IMAGE}

# Image metadata labels
LABEL maintainer="Zero Echelon <platform@zeroechelon.com>" \
      org.opencontainers.image.title="Outpost v2 Claude Agent" \
      org.opencontainers.image.description="Claude Code CLI agent for Outpost multi-agent platform" \
      org.opencontainers.image.version="2.0.0" \
      org.opencontainers.image.vendor="Zero Echelon" \
      org.opencontainers.image.source="https://github.com/rgsuarez/outpost" \
      org.opencontainers.image.licenses="Proprietary" \
      outpost.agent="claude" \
      outpost.provider="anthropic" \
      outpost.models="claude-opus-4-5-20251101,claude-sonnet-4-5-20250929,claude-haiku-4-5-20250801"

# Switch to root for package installation
USER root

# Create agent-specific directories
RUN mkdir -p /opt/agents/claude \
    && chown -R outpost:outpost /opt/agents

# Copy initialization script
COPY --chown=outpost:outpost init.sh /opt/agents/claude/init.sh
RUN chmod +x /opt/agents/claude/init.sh

# Switch back to non-root user for npm install
USER outpost

# Install Claude Code CLI globally via npm
# Using npm prefix configured in base image (/home/outpost/.npm-global)
RUN npm install -g @anthropic-ai/claude-code \
    && claude --version

# -----------------------------------------------------------------------------
# Environment Configuration
# -----------------------------------------------------------------------------

# Agent identification
ENV OUTPOST_AGENT=claude \
    OUTPOST_AGENT_PROVIDER=anthropic

# Default model (can be overridden at runtime)
# Supported: claude-opus-4-5-20251101, claude-sonnet-4-5-20250929, claude-haiku-4-5-20250801
ENV MODEL_ID=claude-sonnet-4-5-20250929

# API key must be injected at runtime (NEVER hardcode!)
# ENV ANTHROPIC_API_KEY must be set when running the container

# Claude Code specific settings
ENV CLAUDE_CODE_HEADLESS=1 \
    CLAUDE_CODE_NO_INTERACTIVE=1 \
    CLAUDE_CODE_PRINT_MODE=1

# Context injection settings
ENV CONTEXT_LEVEL=standard

# -----------------------------------------------------------------------------
# Entrypoint Configuration
# -----------------------------------------------------------------------------

# Create wrapper entrypoint that runs init then executes command
USER root
COPY --chown=root:root entrypoint-claude.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
USER outpost

# Working directory for task execution
WORKDIR /workspace

# Health check - verify CLI is accessible
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD claude --version || exit 1

# Default command runs in print mode for headless execution
# Actual task will be passed via CMD override or TASK env var
CMD ["bash", "-c", "/opt/agents/claude/init.sh && exec bash"]

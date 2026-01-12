#!/usr/bin/env python3
"""
Outpost v2 Grok Agent
=====================
xAI Grok API client for Outpost multi-agent execution platform.

Supports:
- Task execution via command line or stdin
- Streaming responses via SSE
- Model selection (grok-4.1, grok-4.1-fast-reasoning)
- Graceful error handling

Usage:
    grok-agent.py --task "Your task here"
    echo "Your task" | grok-agent.py --stdin
    grok-agent.py --task "Task" --model grok-4.1-fast-reasoning
"""

import argparse
import json
import os
import sys
from typing import Generator, Optional

try:
    import requests
except ImportError:
    print("FATAL: requests package not installed", file=sys.stderr)
    sys.exit(1)

try:
    import sseclient
except ImportError:
    sseclient = None  # Streaming will fall back to non-streaming


# =============================================================================
# Configuration
# =============================================================================

XAI_API_ENDPOINT = os.environ.get("XAI_API_ENDPOINT", "https://api.x.ai/v1")
XAI_API_KEY = os.environ.get("XAI_API_KEY", "")
DEFAULT_MODEL = os.environ.get("MODEL_ID", os.environ.get("GROK_DEFAULT_MODEL", "grok-4.1"))
MAX_TOKENS = int(os.environ.get("GROK_MAX_TOKENS", "8192"))
TEMPERATURE = float(os.environ.get("GROK_TEMPERATURE", "0.7"))
TIMEOUT = int(os.environ.get("GROK_TIMEOUT", "300"))
STREAM_ENABLED = os.environ.get("GROK_STREAM", "true").lower() == "true"


# =============================================================================
# API Client
# =============================================================================

class GrokClient:
    """xAI Grok API client with streaming support."""

    def __init__(self, api_key: str, endpoint: str = XAI_API_ENDPOINT):
        self.api_key = api_key
        self.endpoint = endpoint.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        })

    def chat(
        self,
        messages: list[dict],
        model: str = DEFAULT_MODEL,
        stream: bool = STREAM_ENABLED,
        max_tokens: int = MAX_TOKENS,
        temperature: float = TEMPERATURE,
    ) -> dict:
        """Send a chat completion request."""
        url = f"{self.endpoint}/chat/completions"

        payload = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": stream,
        }

        try:
            if stream and sseclient:
                return self._stream_response(url, payload)
            else:
                return self._sync_response(url, payload)
        except requests.exceptions.Timeout:
            return {"error": "Request timed out", "status": "timeout"}
        except requests.exceptions.RequestException as e:
            return {"error": str(e), "status": "error"}

    def _sync_response(self, url: str, payload: dict) -> dict:
        """Non-streaming API call."""
        payload["stream"] = False
        response = self.session.post(url, json=payload, timeout=TIMEOUT)

        if response.status_code != 200:
            return {
                "error": f"API error: {response.status_code}",
                "detail": response.text,
                "status": "error",
            }

        data = response.json()
        return {
            "content": data["choices"][0]["message"]["content"],
            "model": data.get("model", payload["model"]),
            "usage": data.get("usage", {}),
            "status": "success",
        }

    def _stream_response(self, url: str, payload: dict) -> dict:
        """Streaming API call using SSE."""
        payload["stream"] = True
        response = self.session.post(url, json=payload, timeout=TIMEOUT, stream=True)

        if response.status_code != 200:
            return {
                "error": f"API error: {response.status_code}",
                "detail": response.text,
                "status": "error",
            }

        client = sseclient.SSEClient(response)
        content_parts = []
        usage = {}
        model = payload["model"]

        for event in client.events():
            if event.data == "[DONE]":
                break

            try:
                chunk = json.loads(event.data)
                if "choices" in chunk and chunk["choices"]:
                    delta = chunk["choices"][0].get("delta", {})
                    if "content" in delta:
                        content = delta["content"]
                        content_parts.append(content)
                        # Stream to stdout in real-time
                        print(content, end="", flush=True)

                if "usage" in chunk:
                    usage = chunk["usage"]
                if "model" in chunk:
                    model = chunk["model"]
            except json.JSONDecodeError:
                continue

        # Newline after streaming completes
        if content_parts:
            print()

        return {
            "content": "".join(content_parts),
            "model": model,
            "usage": usage,
            "status": "success",
        }


# =============================================================================
# Task Execution
# =============================================================================

SYSTEM_PROMPT = """You are Grok, an AI coding assistant working on a git repository.
You are part of the Outpost multi-agent platform, executing tasks for developers.

Guidelines:
1. Analyze the task carefully before responding
2. Provide clear, production-ready code
3. When modifying files, show the complete updated content
4. Use format: ```language:path/to/file for code blocks
5. Be concise but thorough
6. If the task is unclear, state your assumptions

You have access to the workspace at /workspace."""


def execute_task(task: str, model: str, client: GrokClient) -> int:
    """Execute a task and return exit code."""

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": task},
    ]

    print(f"Executing task with model: {model}", file=sys.stderr)
    print("-" * 60, file=sys.stderr)

    result = client.chat(messages, model=model)

    if result["status"] == "success":
        # If not streaming, print the content now
        if not STREAM_ENABLED or not sseclient:
            print(result["content"])

        # Print usage stats to stderr
        usage = result.get("usage", {})
        if usage:
            print("-" * 60, file=sys.stderr)
            print(f"Tokens - Input: {usage.get('prompt_tokens', 'N/A')}, "
                  f"Output: {usage.get('completion_tokens', 'N/A')}, "
                  f"Total: {usage.get('total_tokens', 'N/A')}", file=sys.stderr)

        return 0
    else:
        print(f"ERROR: {result.get('error', 'Unknown error')}", file=sys.stderr)
        if "detail" in result:
            print(f"Detail: {result['detail']}", file=sys.stderr)
        return 1


# =============================================================================
# CLI Interface
# =============================================================================

def parse_args() -> argparse.Namespace:
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="Outpost v2 Grok Agent - xAI API client",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    grok-agent.py --task "Explain this code"
    grok-agent.py --task "Fix the bug" --model grok-4.1-fast-reasoning
    echo "Summarize the README" | grok-agent.py --stdin
    grok-agent.py --task "Optimize this function" --no-stream
        """
    )

    parser.add_argument(
        "--task", "-t",
        help="Task to execute (or use --stdin to read from stdin)"
    )
    parser.add_argument(
        "--stdin", "-s",
        action="store_true",
        help="Read task from stdin"
    )
    parser.add_argument(
        "--model", "-m",
        default=DEFAULT_MODEL,
        help=f"Model to use (default: {DEFAULT_MODEL})"
    )
    parser.add_argument(
        "--no-stream",
        action="store_true",
        help="Disable streaming responses"
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output result as JSON"
    )
    parser.add_argument(
        "--version", "-v",
        action="version",
        version="Outpost Grok Agent v2.0.0"
    )

    return parser.parse_args()


def main() -> int:
    """Main entry point."""
    args = parse_args()

    # Validate API key
    if not XAI_API_KEY:
        print("FATAL: XAI_API_KEY environment variable is not set", file=sys.stderr)
        return 1

    # Get task from args or stdin
    task: Optional[str] = None

    if args.stdin:
        task = sys.stdin.read().strip()
    elif args.task:
        task = args.task
    else:
        print("ERROR: No task provided. Use --task or --stdin", file=sys.stderr)
        return 1

    if not task:
        print("ERROR: Empty task provided", file=sys.stderr)
        return 1

    # Override streaming if requested
    global STREAM_ENABLED
    if args.no_stream:
        STREAM_ENABLED = False

    # Initialize client
    client = GrokClient(api_key=XAI_API_KEY)

    # Execute task
    if args.json:
        # JSON output mode
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": task},
        ]
        # Force non-streaming for JSON mode
        result = client.chat(messages, model=args.model, stream=False)
        print(json.dumps(result, indent=2))
        return 0 if result["status"] == "success" else 1
    else:
        return execute_task(task, args.model, client)


if __name__ == "__main__":
    sys.exit(main())

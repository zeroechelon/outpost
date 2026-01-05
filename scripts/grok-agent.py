#!/usr/bin/env python3
"""
grok-agent.py - Grok API agent for Outpost
Uses xAI API (OpenAI-compatible) to execute coding tasks

Usage: grok-agent.py --repo <repo> --task "<task>" --workspace <path>
"""

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

try:
    from openai import OpenAI
except ImportError:
    print("❌ openai package not installed. Run: pip install openai")
    sys.exit(1)


def parse_args():
    parser = argparse.ArgumentParser(description="Grok API agent for Outpost")
    parser.add_argument("--repo", required=True, help="Repository name")
    parser.add_argument("--task", required=True, help="Task to execute")
    parser.add_argument("--workspace", required=True, help="Workspace directory")
    parser.add_argument("--model", default="grok-4.1", help="Grok model (grok-4.1, grok-4.1-mini, grok-2)")
    return parser.parse_args()


def get_repo_context(workspace: str, max_files: int = 20) -> str:
    """Get repository structure and key files for context."""
    context_parts = []
    workspace_path = Path(workspace)

    # Get directory structure
    try:
        result = subprocess.run(
            ["find", ".", "-type", "f", "-name", "*.py", "-o", "-name", "*.js",
             "-o", "-name", "*.ts", "-o", "-name", "*.sh", "-o", "-name", "*.md"],
            cwd=workspace,
            capture_output=True,
            text=True,
            timeout=10
        )
        files = [f for f in result.stdout.strip().split("\n") if f][:max_files]
        if files:
            context_parts.append("## Repository Files\n" + "\n".join(files))
    except Exception as e:
        context_parts.append(f"## Repository Files\n(Could not list: {e})")

    # Read README if exists
    readme_path = workspace_path / "README.md"
    if readme_path.exists():
        try:
            readme_content = readme_path.read_text()[:2000]
            context_parts.append(f"## README.md\n{readme_content}")
        except:
            pass

    return "\n\n".join(context_parts)


def extract_code_blocks(response: str) -> list[dict]:
    """Extract code blocks with file paths from Grok's response."""
    blocks = []

    # Pattern: ```language:path/to/file or ```language path/to/file
    pattern = r"```(\w+)?[:\s]*([\w/\.\-_]+)?\n(.*?)```"
    matches = re.findall(pattern, response, re.DOTALL)

    for lang, filepath, code in matches:
        if filepath and not filepath.startswith("output") and "/" in filepath or "." in filepath:
            blocks.append({
                "language": lang or "text",
                "filepath": filepath,
                "code": code.strip()
            })

    # Also look for explicit file markers
    # Pattern: File: path/to/file or # path/to/file followed by code block
    file_pattern = r"(?:File:|#)\s*([\w/\.\-_]+)\s*\n```\w*\n(.*?)```"
    file_matches = re.findall(file_pattern, response, re.DOTALL)

    for filepath, code in file_matches:
        if filepath not in [b["filepath"] for b in blocks]:
            blocks.append({
                "language": "text",
                "filepath": filepath,
                "code": code.strip()
            })

    return blocks


def apply_code_changes(workspace: str, blocks: list[dict]) -> list[str]:
    """Apply extracted code blocks to workspace files."""
    applied = []
    workspace_path = Path(workspace)

    for block in blocks:
        filepath = block["filepath"]
        code = block["code"]

        # Security: ensure path is within workspace
        target = (workspace_path / filepath).resolve()
        if not str(target).startswith(str(workspace_path.resolve())):
            print(f"⚠️ Skipping path outside workspace: {filepath}")
            continue

        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(code)
            applied.append(filepath)
            print(f"   ✅ Wrote: {filepath}")
        except Exception as e:
            print(f"   ❌ Failed to write {filepath}: {e}")

    return applied


def main():
    args = parse_args()

    # Get API key from environment
    api_key = os.environ.get("GROK_API_KEY")
    if not api_key:
        print("❌ GROK_API_KEY environment variable not set")
        sys.exit(1)

    print(f"🤖 Grok agent starting...")
    print(f"   Model: {args.model}")
    print(f"   Workspace: {args.workspace}")

    # Initialize xAI client (OpenAI-compatible)
    client = OpenAI(
        api_key=api_key,
        base_url="https://api.x.ai/v1"
    )

    # Build context
    repo_context = get_repo_context(args.workspace)

    system_prompt = """You are a coding assistant working on a git repository.
When providing code changes:
1. Always specify the full file path
2. Use format: ```language:path/to/file
3. Provide complete file contents, not just snippets
4. Be precise and production-ready

Repository context is provided below."""

    user_prompt = f"""## Task
{args.task}

## Repository Context
{repo_context}

Please analyze the task and provide the necessary code changes. For each file you modify or create, use the format:

```language:path/to/file
<complete file contents>
```"""

    print("   Calling Grok API...")

    try:
        response = client.chat.completions.create(
            model=args.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.7,
            max_tokens=4096
        )

        content = response.choices[0].message.content
        print("\n" + "=" * 60)
        print("GROK RESPONSE:")
        print("=" * 60)
        print(content)
        print("=" * 60 + "\n")

        # Extract and apply code blocks
        blocks = extract_code_blocks(content)
        if blocks:
            print(f"📝 Extracted {len(blocks)} code block(s)")
            applied = apply_code_changes(args.workspace, blocks)
            print(f"   Applied {len(applied)} file(s)")
        else:
            print("📝 No code blocks to apply (response may be advisory)")

        # Return success
        result = {
            "status": "success",
            "model": args.model,
            "response_length": len(content),
            "blocks_extracted": len(blocks),
            "files_applied": len(blocks)
        }
        print(json.dumps(result))
        return 0

    except Exception as e:
        print(f"❌ Grok API error: {e}")
        result = {
            "status": "failed",
            "error": str(e)
        }
        print(json.dumps(result))
        return 1


if __name__ == "__main__":
    sys.exit(main())

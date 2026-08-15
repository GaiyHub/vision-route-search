#!/usr/bin/env python3
"""Stop hook: 每轮代码任务结束前，用 Codex review 对未提交增量做一次 CR。"""
import json
import os
import subprocess
import sys


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")


def repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main() -> None:
    root = repo_root()

    # 没有未提交改动就放行
    status = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=root,
        capture_output=True,
        text=True,
    )
    if not status.stdout.strip():
        emit({"continue": True})
        return

    try:
        prompt = (
            "Use $review-agent to review the uncommitted changes in this repository "
            "(staged, unstaged, and untracked). Return every actionable finding ordered "
            "by severity, or say 'No findings.' if there are none."
        )
        result = subprocess.run(
            ["codex", "exec", "--disable", "hooks", prompt],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=600,
        )
    except Exception as exc:  # 超时、找不到 codex 等
        emit({"decision": "block", "reason": f"增量 CR 执行失败：{exc}"})
        return

    out = (result.stdout or "").strip()

    if result.returncode != 0:
        detail = (result.stderr or out or "unknown error").strip()
        emit({"decision": "block", "reason": f"增量 CR 失败：{detail}"})
        return

    if "no findings" in out.lower():
        emit({"continue": True})
        return

    reason = ("本轮增量 CR 发现问题，请逐条修复后再结束：\n" + out)[:8000]
    emit({"decision": "block", "reason": reason})


if __name__ == "__main__":
    main()

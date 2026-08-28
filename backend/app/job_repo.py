from __future__ import annotations

from .history import delete_record, list_disk_jobs, load_record
from .job_public import public_from_job
from .jobs import runner


class JobBusy(RuntimeError):
    pass


def get_public(job_id: str) -> dict:
    try:
        return public_from_job(runner.get(job_id))
    except KeyError:
        from .history import public_from_record

        return public_from_record(load_record(job_id))


def list_public() -> list[dict]:
    seen: set[str] = set()
    items = []
    for job in list(runner.jobs.values()):
        items.append(public_from_job(job))
        seen.add(job.id)
    for item in list_disk_jobs():
        if item["id"] in seen:
            continue
        items.append(item)
        seen.add(item["id"])
    items.sort(key=lambda row: str(row.get("created_at") or ""), reverse=True)
    return items


def item_list(job_id: str, key: str) -> list[dict]:
    try:
        job = runner.get(job_id)
        if job.status == "done":
            return list(job.stats.get(key) or [])
    except KeyError:
        pass
    try:
        return list(load_record(job_id).get(key) or [])
    except KeyError:
        return []


def delete_job(job_id: str) -> None:
    try:
        job = runner.get(job_id)
        if job.status in {"queued", "running", "cancelling"}:
            raise JobBusy("任务还在生成，不能删除")
        runner.forget(job_id)
    except KeyError:
        pass
    delete_record(job_id)

"""HTTP entrypoint for the AccessiBU API.

Creates the FastAPI application, exposes a health check, and mounts
member authentication. Report submission and hazard alerts are not
served here.
"""

from fastapi import FastAPI

from app.members.router import router as members_router

app = FastAPI(title="AccessiBU")
app.include_router(members_router)


@app.get("/health")
def health() -> dict[str, str]:
    """Reports that the process is serving requests.

    Returns:
        A JSON object whose status is "ok".
    """
    return {"status": "ok"}

"""HTTP entrypoint for the AccessiBU API.

Creates the FastAPI application, exposes a health check, and mounts
member authentication. Report submission and hazard alerts are not
served here.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.members.router import router as members_router


def _cors_origins() -> list[str]:
    """Splits the configured browser origins.

    Returns:
        Origins allowed to call the API from a browser, in order.
    """
    return [
        origin.strip()
        for origin in get_settings().cors_origins.split(",")
        if origin.strip()
    ]


app = FastAPI(title="AccessiBU")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(members_router)


@app.get("/health")
def health() -> dict[str, str]:
    """Reports that the process is serving requests.

    Returns:
        A JSON object whose status is "ok".
    """
    return {"status": "ok"}

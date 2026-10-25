"""HTTP entrypoint for the AccessiBU API.

Creates the FastAPI application, exposes a health check, and mounts
member authentication, hazard reads, report submission, photo
preview classification, and admin-only Facilities routes. Facilities
email is not sent here.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.admin.router import router as admin_router
from app.config import get_settings
from app.hazards.router import router as hazards_router
from app.members.router import router as members_router
from app.reports.router import classify_router
from app.reports.router import router as reports_router


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
app.include_router(hazards_router)
app.include_router(admin_router)
app.include_router(reports_router)
app.include_router(classify_router)


@app.get("/health")
def health() -> dict[str, str]:
    """Reports that the process is serving requests.

    Returns:
        A JSON object whose status is "ok".
    """
    return {"status": "ok"}

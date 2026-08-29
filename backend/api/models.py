"""Request and response shapes for the generation API."""

from typing import List, Optional

from pydantic import BaseModel, Field


class GenerateRequest(BaseModel):
    name: str = Field(..., min_length=1, description='Display name, e.g. "Portugal".')


class JobResponse(BaseModel):
    id: Optional[str] = None
    code: str
    name: str
    slug: str
    status: str
    stage: Optional[str] = None
    message: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    error: Optional[str] = None


class CountryResponse(BaseModel):
    code: str
    name: str
    slug: str
    status: str
    output_dir: Optional[str] = None
    job_id: Optional[str] = None


class MediaItem(BaseModel):
    event_id: str
    order: int
    url: str
    title: Optional[str] = None
    timeline: Optional[str] = None


class MediaResponse(BaseModel):
    code: str
    name: str
    slug: str
    # `status` reports images and videos independently: a country reaches `images_ready`
    # roughly ten minutes before `ready`, so a client can show art without waiting for video.
    status: str
    images: List[MediaItem] = []
    videos: List[MediaItem] = []

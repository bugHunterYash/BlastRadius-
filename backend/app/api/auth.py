from __future__ import annotations

import os
from typing import Optional
from fastapi import APIRouter, Depends, Header, HTTPException, status
import httpx
from pydantic import BaseModel

router = APIRouter(prefix="/api/auth", tags=["auth"])

GOOGLE_CLIENT_ID = os.getenv(
    "GOOGLE_CLIENT_ID",
    "555320801039-ml9n3g5d01ok722kraduvsk425btnsql.apps.googleusercontent.com",
)


class UserProfile(BaseModel):
    id: str
    email: str
    name: Optional[str] = None
    picture: Optional[str] = None
    email_verified: bool = False


async def verify_google_id_token(token: str) -> UserProfile:
    """Verify Google OAuth ID token using Google's tokeninfo API."""
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(
                "https://oauth2.googleapis.com/tokeninfo",
                params={"id_token": token},
                timeout=5.0,
            )
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Unable to reach Google auth service: {exc}",
            )

    if response.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Google ID token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    data = response.json()
    # Verify audience matches our Client ID if client ID is specified
    aud = data.get("aud")
    if GOOGLE_CLIENT_ID and aud != GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token audience mismatch: expected {GOOGLE_CLIENT_ID}, got {aud}",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return UserProfile(
        id=data.get("sub", ""),
        email=data.get("email", ""),
        name=data.get("name"),
        picture=data.get("picture"),
        email_verified=data.get("email_verified") in ("true", True),
    )


async def get_current_user(
    authorization: Optional[str] = Header(None),
) -> Optional[UserProfile]:
    """Dependency to retrieve the authenticated user from the Authorization header."""
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization header scheme. Must be Bearer <token>",
        )
    return await verify_google_id_token(token)


@router.get("/me", response_model=Optional[UserProfile])
async def get_me(user: Optional[UserProfile] = Depends(get_current_user)):
    """Return currently logged-in user profile, or null if unauthenticated."""
    return user


class VerifyRequest(BaseModel):
    id_token: str


@router.post("/verify", response_model=UserProfile)
async def verify_token(req: VerifyRequest):
    """Directly verify a Google ID token and return profile."""
    return await verify_google_id_token(req.id_token)

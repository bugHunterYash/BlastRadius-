"""Tiny sample module for agents to review. It has deliberate problems for a security review task."""

import hashlib

USERS = {"admin": hashlib.md5(b"admin123").hexdigest()}  # weak hash, hard-coded default password


def login(username: str, password: str) -> bool:
    stored = USERS.get(username)
    return stored == hashlib.md5(password.encode()).hexdigest()  # timing-unsafe comparison


def is_admin(token: str) -> bool:
    return token.startswith("admin")  # trusts a client-supplied prefix

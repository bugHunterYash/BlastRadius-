"""The interface every agent runtime implements. The router and execution service only use this."""

from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable

from app.runtime.models import ProviderHealth, RuntimeEvent, RuntimeRequest, RuntimeResult

EventSink = Callable[[RuntimeEvent], Awaitable[None]]


class RuntimeError_(Exception):
    """A runtime could not run the request (not installed, not authenticated, protocol error)."""


class AgentRuntime(ABC):
    name: str
    provider: str

    async def start(self) -> None:
        """Prepare long-lived resources. Adapters here start per invocation, so this is optional."""

    @abstractmethod
    async def invoke(self, request: RuntimeRequest, emit: EventSink) -> RuntimeResult:
        """Run one task to the end, calling emit() for every observable event, in order."""

    async def resume(self, provider_session_id: str, request: RuntimeRequest, emit: EventSink) -> RuntimeResult:
        return await self.invoke(request.model_copy(update={"resume_provider_session_id": provider_session_id}), emit)

    @abstractmethod
    async def cancel(self, invocation_id: str) -> bool:
        """Ask the provider to stop; returns False if the invocation isn't running here."""

    @abstractmethod
    async def health(self) -> ProviderHealth:
        """A real check (process starts, handshake works), not just "config exists"."""

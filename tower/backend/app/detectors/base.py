from dataclasses import dataclass


@dataclass
class IssueDraft:
    type: str
    agent: str
    fact_key: str | None
    evidence: list[str]          # event_ids that prove it
    detail: str = ""             # one plain sentence for the issue card

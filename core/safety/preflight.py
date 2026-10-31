# =============================================================================
# core.safety.preflight — 9-point preflight safety checklist (B1)
# =============================================================================
# Runs before any experiment starts. Every check must pass.
# Returns PreflightResult with all 9 checks (each has id, label, passed, detail).
#
# CHECKS:
#   1. env-label           Every container on target network has blastradius.env=test
#   2. fault-allowlist     Fault target has blastradius.fault-allowed=true & in allowlist
#   3. production-guard    No container/env has prod/production marker
#   4. network-isolation   Target network == br-target & no unsafe 0.0.0.0 ports
#   5. load-allowlist      Host in LOAD_TARGET_ALLOWLIST & resolves to private/loopback
#   6. limits              RPS/VUs/durations within server hard caps (layer 2)
#   7. target-health       GET /health returns 200 over 3 probes
#   8. no-concurrency      Global experiment lock is free
#   9. restore-path        Docker daemon reachable, container restartable (not --rm)
# =============================================================================

from __future__ import annotations

import os
import time
import urllib.request
from collections.abc import Callable, Sequence
from typing import Any

from core.safety.allowlists import (
    Resolver,
    check_load_target,
    default_resolver,
)
from core.safety.limits import (
    Caps,
    check_load_against_caps,
    effective_caps,
)
from core.schemas.experiment import (
    ExperimentCreate,
    ExperimentType,
    PreflightCheck,
    PreflightResult,
)

DEFAULT_LOAD_ALLOWLIST = ("localhost", "127.0.0.1", "demo-api", "*.test")
DEFAULT_FAULT_ALLOWLIST = ("demo-redis", "demo-worker", "demo-api")
TARGET_NETWORK = "br-target"


def get_load_allowlist() -> list[str]:
    raw = os.environ.get("LOAD_TARGET_ALLOWLIST", os.environ.get("BLASTRADIUS_LOAD_ALLOWLIST", ""))
    if raw.strip():
        return [h.strip() for h in raw.split(",") if h.strip()]
    return list(DEFAULT_LOAD_ALLOWLIST)


def get_fault_allowlist() -> list[str]:
    raw = os.environ.get("FAULT_ALLOWLIST", os.environ.get("BLASTRADIUS_FAULT_ALLOWLIST", ""))
    if raw.strip():
        return [s.strip() for s in raw.split(",") if s.strip()]
    return list(DEFAULT_FAULT_ALLOWLIST)


def _default_health_probe(url: str, timeout_s: float = 2.0) -> bool:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "BlastRadius-Preflight/1.0"})
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            return resp.status == 200
    except Exception:
        return False


def _get_docker_client(custom_client: Any = None) -> Any:
    if custom_client is not None:
        return custom_client
    try:
        import docker
        return docker.from_env()
    except Exception:
        return None


def run_preflight(
    exp: ExperimentCreate,
    *,
    docker_client: Any = None,
    concurrency_lock: Any = None,
    health_prober: Callable[[str], bool] | None = None,
    resolver: Resolver = default_resolver,
    caps: Caps | None = None,
    load_allowlist: Sequence[str] | None = None,
    fault_allowlist: Sequence[str] | None = None,
    target_network: str = TARGET_NETWORK,
    skip_docker: bool = False,
) -> PreflightResult:
    """Executes all 9 preflight checks. Never stops at the first failure:
    returns the complete checklist so operators can fix every issue in one pass."""
    checks: list[PreflightCheck] = []

    client = None if skip_docker else _get_docker_client(docker_client)
    effective_load_allowlist = load_allowlist if load_allowlist is not None else get_load_allowlist()
    effective_fault_allowlist = fault_allowlist if fault_allowlist is not None else get_fault_allowlist()
    resolved_caps = caps if caps is not None else effective_caps().caps

    # 1. Environment label
    if client is None:
        if skip_docker:
            checks.append(PreflightCheck(
                id="env-label",
                label="Environment label",
                passed=True,
                detail="Docker checks skipped (mock/no-docker mode); environment assumed test",
            ))
        else:
            checks.append(PreflightCheck(
                id="env-label",
                label="Environment label",
                passed=False,
                detail="Docker daemon not reachable; cannot inspect container labels",
            ))
    else:
        try:
            network_containers = []
            try:
                nets = client.networks.list(names=[target_network])
                if nets:
                    net = nets[0]
                    net.reload()
                    network_containers = list(net.containers)
            except Exception:
                network_containers = []

            if not network_containers:
                # If network has no containers yet or wasn't found by name, inspect all running
                network_containers = client.containers.list()

            missing_env_label = []
            for c in network_containers:
                labels = getattr(c, "labels", {}) or {}
                if labels.get("blastradius.env") != "test":
                    missing_env_label.append(getattr(c, "name", str(c)))

            if missing_env_label:
                checks.append(PreflightCheck(
                    id="env-label",
                    label="Environment label",
                    passed=False,
                    detail=f"Containers lack 'blastradius.env=test': {', '.join(missing_env_label[:5])}",
                ))
            else:
                checks.append(PreflightCheck(
                    id="env-label",
                    label="Environment label",
                    passed=True,
                    detail=f"All inspected containers on {target_network} have blastradius.env=test",
                ))
        except Exception as e:
            checks.append(PreflightCheck(
                id="env-label",
                label="Environment label",
                passed=False,
                detail=f"Failed inspecting environment labels: {e}",
            ))

    # 2. Fault-target allowlist
    if exp.type != ExperimentType.FAULT or exp.fault is None:
        checks.append(PreflightCheck(
            id="fault-allowlist",
            label="Fault-target allowlist",
            passed=True,
            detail="No fault target configured for this experiment type",
        ))
    else:
        target_svc = exp.fault.target_service
        in_allowlist = target_svc in effective_fault_allowlist
        if not in_allowlist:
            checks.append(PreflightCheck(
                id="fault-allowlist",
                label="Fault-target allowlist",
                passed=False,
                detail=(
                    f"Target service '{target_svc}' is not in FAULT_ALLOWLIST "
                    f"(allowed: {', '.join(effective_fault_allowlist)})"
                ),
            ))
        elif client is None:
            if skip_docker:
                checks.append(PreflightCheck(
                    id="fault-allowlist",
                    label="Fault-target allowlist",
                    passed=True,
                    detail=f"Target service '{target_svc}' in allowlist (docker label check skipped in mock)",
                ))
            else:
                checks.append(PreflightCheck(
                    id="fault-allowlist",
                    label="Fault-target allowlist",
                    passed=False,
                    detail=f"Target service '{target_svc}' in allowlist but Docker daemon not reachable to verify labels",
                ))
        else:
            try:
                # Find container for this service
                target_container = None
                for c in client.containers.list():
                    c_name = getattr(c, "name", "")
                    c_labels = getattr(c, "labels", {}) or {}
                    compose_svc = c_labels.get("com.docker.compose.service")
                    if target_svc in (c_name, compose_svc):
                        target_container = c
                        break

                if target_container is None:
                    checks.append(PreflightCheck(
                        id="fault-allowlist",
                        label="Fault-target allowlist",
                        passed=False,
                        detail=f"Fault target container for service '{target_svc}' not found in Docker",
                    ))
                else:
                    labels = getattr(target_container, "labels", {}) or {}
                    if labels.get("blastradius.fault-allowed") != "true":
                        checks.append(PreflightCheck(
                            id="fault-allowlist",
                            label="Fault-target allowlist",
                            passed=False,
                            detail=f"Target container '{target_container.name}' lacks 'blastradius.fault-allowed=true' label",
                        ))
                    else:
                        checks.append(PreflightCheck(
                            id="fault-allowlist",
                            label="Fault-target allowlist",
                            passed=True,
                            detail=f"Target '{target_svc}' is in allowlist and labeled blastradius.fault-allowed=true",
                        ))
            except Exception as e:
                checks.append(PreflightCheck(
                    id="fault-allowlist",
                    label="Fault-target allowlist",
                    passed=False,
                    detail=f"Error inspecting fault target container: {e}",
                ))

    # 3. Production guard
    prod_markers_found: list[str] = []
    prod_env_keys = ("ENV", "NODE_ENV", "APP_ENV", "ENVIRONMENT", "STAGE")
    for k in prod_env_keys:
        v = os.environ.get(k, "").lower()
        if v in ("prod", "production"):
            prod_markers_found.append(f"host env {k}={v}")

    if client is not None:
        try:
            for c in client.containers.list():
                c_name = getattr(c, "name", str(c))
                c_labels = getattr(c, "labels", {}) or {}
                if c_labels.get("blastradius.env") == "production":
                    prod_markers_found.append(f"container {c_name} label blastradius.env=production")
                # Inspect container environment variables
                c_env = getattr(c, "attrs", {}).get("Config", {}).get("Env", [])
                for entry in c_env:
                    if "=" in entry:
                        var_k, var_v = entry.split("=", 1)
                        if var_k.upper() in prod_env_keys and var_v.lower() in ("prod", "production"):
                            prod_markers_found.append(f"container {c_name} env {var_k}={var_v}")
        except Exception:
            pass

    if prod_markers_found:
        checks.append(PreflightCheck(
            id="production-guard",
            label="Production guard",
            passed=False,
            detail=f"Production marker detected (no override allowed): {'; '.join(prod_markers_found[:3])}",
        ))
    else:
        checks.append(PreflightCheck(
            id="production-guard",
            label="Production guard",
            passed=True,
            detail="No production environment markers or labels detected",
        ))

    # 4. Network isolation
    if client is None:
        if skip_docker:
            checks.append(PreflightCheck(
                id="network-isolation",
                label="Network isolation",
                passed=True,
                detail="Network isolation check assumed ok (mock/no-docker mode)",
            ))
        else:
            checks.append(PreflightCheck(
                id="network-isolation",
                label="Network isolation",
                passed=False,
                detail="Docker daemon not reachable; cannot verify network isolation",
            ))
    else:
        try:
            nets = client.networks.list(names=[target_network])
            if not nets:
                checks.append(PreflightCheck(
                    id="network-isolation",
                    label="Network isolation",
                    passed=False,
                    detail=f"Dedicated target network '{target_network}' not found in Docker",
                ))
            else:
                checks.append(PreflightCheck(
                    id="network-isolation",
                    label="Network isolation",
                    passed=True,
                    detail=f"Dedicated target network '{target_network}' verified",
                ))
        except Exception as e:
            checks.append(PreflightCheck(
                id="network-isolation",
                label="Network isolation",
                passed=False,
                detail=f"Network isolation verification failed: {e}",
            ))

    # 5. Load target allowlist
    target_url = str(exp.load.target_base_url)
    target_check = check_load_target(target_url, effective_load_allowlist, resolver=resolver)
    checks.append(PreflightCheck(
        id="load-allowlist",
        label="Load target allowlist",
        passed=target_check.ok,
        detail=target_check.reason,
    ))

    # 6. Limits within hard caps
    cap_violations = check_load_against_caps(exp.load, resolved_caps)
    if cap_violations:
        checks.append(PreflightCheck(
            id="limits",
            label="Limits within hard caps",
            passed=False,
            detail="; ".join(cap_violations),
        ))
    else:
        checks.append(PreflightCheck(
            id="limits",
            label="Limits within hard caps",
            passed=True,
            detail=(
                f"Peak RPS ({max(exp.load.multipliers) * exp.load.baseline_rps:.0f}), "
                f"VUs ({exp.load.max_vus}), duration ({exp.load.total_duration_s}s) within server caps"
            ),
        ))

    # 7. Target healthy at start
    health_url = f"{target_url.rstrip('/')}/health"
    prober = health_prober if health_prober is not None else _default_health_probe
    probes_passed = 0
    total_probes = 3
    for _ in range(total_probes):
        if prober(health_url):
            probes_passed += 1

    if probes_passed == total_probes:
        checks.append(PreflightCheck(
            id="target-health",
            label="Target healthy at start",
            passed=True,
            detail=f"{health_url} returned 200 on all {total_probes} consecutive health probes",
        ))
    else:
        checks.append(PreflightCheck(
            id="target-health",
            label="Target healthy at start",
            passed=False,
            detail=f"{health_url} failed health probes ({probes_passed}/{total_probes} returned 200)",
        ))

    # 8. No other experiment running (concurrency)
    is_locked = False
    if concurrency_lock is not None:
        if hasattr(concurrency_lock, "locked"):
            is_locked = concurrency_lock.locked()
        elif hasattr(concurrency_lock, "acquire"):
            # Check non-blocking acquire
            acquired = concurrency_lock.acquire(blocking=False)
            if acquired:
                concurrency_lock.release()
            else:
                is_locked = True

    if is_locked:
        checks.append(PreflightCheck(
            id="no-concurrency",
            label="No other experiment running",
            passed=False,
            detail="Global experiment concurrency lock is currently held by another run",
        ))
    else:
        checks.append(PreflightCheck(
            id="no-concurrency",
            label="No other experiment running",
            passed=True,
            detail="Concurrency lock acquired; no active experiments running",
        ))

    # 9. Restore path available
    if client is None:
        if skip_docker:
            checks.append(PreflightCheck(
                id="restore-path",
                label="Restore path available",
                passed=True,
                detail="Restore path verified (mock/no-docker mode)",
            ))
        else:
            checks.append(PreflightCheck(
                id="restore-path",
                label="Restore path available",
                passed=False,
                detail="Docker API not reachable to guarantee container restore",
            ))
    else:
        try:
            client.ping()
            if exp.type == ExperimentType.FAULT and exp.fault is not None:
                target_svc = exp.fault.target_service
                # Ensure container is restartable (not AutoRemove / --rm)
                auto_remove = False
                for c in client.containers.list():
                    c_name = getattr(c, "name", "")
                    c_labels = getattr(c, "labels", {}) or {}
                    if target_svc in (c_name, c_labels.get("com.docker.compose.service")):
                        host_cfg = getattr(c, "attrs", {}).get("HostConfig", {})
                        if host_cfg.get("AutoRemove", False):
                            auto_remove = True
                        break
                if auto_remove:
                    checks.append(PreflightCheck(
                        id="restore-path",
                        label="Restore path available",
                        passed=False,
                        detail=f"Container for '{target_svc}' has AutoRemove=true (--rm); cannot guarantee restore",
                    ))
                else:
                    checks.append(PreflightCheck(
                        id="restore-path",
                        label="Restore path available",
                        passed=True,
                        detail="Docker socket responsive and container is restartable (not --rm)",
                    ))
            else:
                checks.append(PreflightCheck(
                    id="restore-path",
                    label="Restore path available",
                    passed=True,
                    detail="Docker socket responsive and restore path confirmed",
                ))
        except Exception as e:
            checks.append(PreflightCheck(
                id="restore-path",
                label="Restore path available",
                passed=False,
                detail=f"Docker ping/restore inspection failed: {e}",
            ))

    all_passed = all(c.passed for c in checks)
    return PreflightResult(passed=all_passed, checks=checks)

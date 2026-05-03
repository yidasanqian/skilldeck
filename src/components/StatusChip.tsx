import type { CommandStatus, EnvironmentOverall } from "../types";

type StatusValue = CommandStatus | EnvironmentOverall | "ok" | "warning" | "danger";

interface StatusChipProps {
  value: StatusValue;
  label: string;
}

export function StatusChip({ value, label }: StatusChipProps) {
  return <span className={`status-chip status-chip--${value}`}>{label}</span>;
}

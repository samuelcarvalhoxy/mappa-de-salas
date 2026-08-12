import { ChevronRight, DoorOpen } from "lucide-react";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`}>
      <div className="brand-mark">
        <DoorOpen size={22} />
      </div>
      {!compact && (
        <div>
          <strong>
            M<span>app</span>a
          </strong>
          <small>de Salas</small>
        </div>
      )}
    </div>
  );
}

export function Summary({
  icon: Icon,
  label,
  value,
  tone,
  onClick,
}: {
  icon: typeof DoorOpen;
  label: string;
  value: string;
  tone: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className={`summary-icon ${tone}`}>
        <Icon size={20} />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </>
  );
  return onClick ? (
    <button className="summary summary-link" onClick={onClick}>
      {content}
      <ChevronRight className="summary-link-arrow" size={18} />
    </button>
  ) : (
    <div className="summary">{content}</div>
  );
}

export function Empty({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof DoorOpen;
  title: string;
  text: string;
}) {
  return (
    <div className="empty">
      <div>
        <Icon size={28} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

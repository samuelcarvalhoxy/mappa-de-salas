"use client";

import { useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import {
  addCalendarDays,
  isSundayDate,
  monthStart,
  nextMonthStart,
  startOfWeekMonday,
} from "@/lib/calendar-utils";
import { requestDateLabel } from "./app-shell-utils";

const WEEKDAYS = ["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"];

function previousMonthStart(value: string) {
  return monthStart(addCalendarDays(monthStart(value), -1));
}

export function AlternateDatePicker({
  minimumDate,
  selectedDates,
  onChange,
  maximum = 30,
}: {
  minimumDate: string;
  selectedDates: string[];
  onChange: (dates: string[]) => void;
  maximum?: number;
}) {
  const [visibleMonth, setVisibleMonth] = useState(() =>
    monthStart(selectedDates[0] || minimumDate),
  );
  const gridDates = useMemo(() => {
    const first = startOfWeekMonday(visibleMonth);
    return Array.from({ length: 42 }, (_, index) =>
      addCalendarDays(first, index),
    );
  }, [visibleMonth]);
  const selected = useMemo(() => new Set(selectedDates), [selectedDates]);
  const monthLabel = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "America/Bahia",
  }).format(new Date(`${visibleMonth}T12:00:00-03:00`));

  const toggle = (date: string) => {
    if (
      date < minimumDate ||
      date.slice(0, 7) !== visibleMonth.slice(0, 7) ||
      isSundayDate(date)
    )
      return;
    if (selected.has(date)) {
      onChange(selectedDates.filter((value) => value !== date));
      return;
    }
    if (selectedDates.length >= maximum) return;
    onChange([...selectedDates, date].sort());
  };

  return (
    <section className="alternate-date-picker" aria-label="Selecionar dias alternados">
      <div className="alternate-picker-head">
        <button
          type="button"
          className="icon-btn"
          aria-label="Mês anterior"
          onClick={() => setVisibleMonth(previousMonthStart(visibleMonth))}
        >
          <ChevronLeft size={17} />
        </button>
        <strong>{monthLabel}</strong>
        <button
          type="button"
          className="icon-btn"
          aria-label="Próximo mês"
          onClick={() => setVisibleMonth(nextMonthStart(visibleMonth))}
        >
          <ChevronRight size={17} />
        </button>
      </div>
      <div className="alternate-weekdays" aria-hidden="true">
        {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
      </div>
      <div className="alternate-calendar-grid">
        {gridDates.map((date) => {
          const outsideMonth = date.slice(0, 7) !== visibleMonth.slice(0, 7);
          const unavailable = date < minimumDate || isSundayDate(date);
          const active = selected.has(date);
          return (
            <button
              type="button"
              key={date}
              className={`${active ? "selected" : ""} ${outsideMonth ? "outside" : ""} ${isSundayDate(date) ? "sunday" : ""}`}
              disabled={outsideMonth || unavailable}
              aria-pressed={active}
              aria-label={`${requestDateLabel(date)}${isSundayDate(date) ? ", domingo indisponível" : active ? ", selecionado" : ""}`}
              onClick={() => toggle(date)}
            >
              <span>{Number(date.slice(-2))}</span>
              {active && <Check size={12} />}
            </button>
          );
        })}
      </div>
      <div className="alternate-picker-foot">
        <span>{selectedDates.length} de {maximum} datas selecionadas</span>
        <small>Domingos permanecem indisponíveis.</small>
      </div>
    </section>
  );
}

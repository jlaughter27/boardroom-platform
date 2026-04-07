import { useState, useMemo } from 'react';
import { useEntitiesStore } from '../../stores/entities.store';
import { isOverdue } from '@boardroom/shared';
import { DayColumn } from './DayColumn';
import type { DayItem } from './DayColumn';

// ---------------------------------------------------------------------------
// Week helpers
// ---------------------------------------------------------------------------

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday start
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekDays(start: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatWeekRange(days: Date[]): string {
  const first = days[0];
  const last = days[6];
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${first.toLocaleDateString(undefined, opts)} - ${last.toLocaleDateString(undefined, opts)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WeekCalendarStrip() {
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const { tasks, commitments } = useEntitiesStore();

  const days = useMemo(() => getWeekDays(weekStart), [weekStart]);
  const today = useMemo(() => new Date(), []);

  // Build a map of date-string -> items for fast lookup
  const itemsByDay = useMemo(() => {
    const map = new Map<string, DayItem[]>();

    const key = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    for (const task of tasks) {
      if (!task.deadline) continue;
      const dl = new Date(task.deadline);
      if (dl >= weekStart && dl < weekEnd) {
        const k = key(dl);
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push({
          id: task.id,
          title: task.title,
          type: 'task',
          isOverdue: isOverdue(dl),
        });
      }
    }

    for (const c of commitments) {
      if (!c.deadline) continue;
      const dl = new Date(c.deadline);
      if (dl >= weekStart && dl < weekEnd) {
        const k = key(dl);
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push({
          id: c.id,
          title: c.description,
          type: 'commitment',
          isOverdue: c.status === 'OPEN' && isOverdue(dl),
        });
      }
    }

    return map;
  }, [tasks, commitments, weekStart]);

  function prevWeek() {
    setWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() - 7);
      return d;
    });
  }

  function nextWeek() {
    setWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(d.getDate() + 7);
      return d;
    });
  }

  function goToday() {
    setWeekStart(getWeekStart(new Date()));
  }

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={prevWeek}
          className="p-1 text-gray-400 hover:text-white transition-colors"
          aria-label="Previous week"
        >
          <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-300">
            {formatWeekRange(days)}
          </span>
          <button
            onClick={goToday}
            className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
          >
            Today
          </button>
        </div>

        <button
          onClick={nextWeek}
          className="p-1 text-gray-400 hover:text-white transition-colors"
          aria-label="Next week"
        >
          <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
            <path
              fillRule="evenodd"
              d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {/* Day columns */}
      <div className="flex divide-x divide-gray-800">
        {days.map((day) => {
          const k = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
          return (
            <DayColumn
              key={k}
              date={day}
              items={itemsByDay.get(k) ?? []}
              isToday={isSameDay(day, today)}
            />
          );
        })}
      </div>
    </div>
  );
}

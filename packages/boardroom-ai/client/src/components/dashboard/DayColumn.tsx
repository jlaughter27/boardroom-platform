export interface DayItem {
  id: string;
  title: string;
  type: 'task' | 'commitment' | 'calendar';
  isOverdue: boolean;
  /** Display time for calendar events, e.g. "10:00 AM" */
  time?: string;
}

interface DayColumnProps {
  date: Date;
  items: DayItem[];
  isToday: boolean;
}

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function isPast(date: Date): boolean {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d < now;
}

const MAX_VISIBLE = 3;

export function DayColumn({ date, items, isToday }: DayColumnProps) {
  const past = !isToday && isPast(date);
  const dayName = DAY_ABBR[date.getDay()];
  const dayNum = date.getDate();
  const overflow = items.length - MAX_VISIBLE;

  return (
    <div
      className={`flex-1 min-w-0 px-2 py-2 ${
        isToday ? 'ring-2 ring-blue-500 rounded bg-gray-800/50' : ''
      }`}
    >
      {/* Header */}
      <div className="text-center mb-2">
        <div className={`text-xs ${past ? 'text-gray-600' : 'text-gray-400'}`}>
          {dayName}
        </div>
        <div
          className={`text-lg font-bold ${
            isToday ? 'text-blue-400' : past ? 'text-gray-500' : 'text-white'
          }`}
        >
          {dayNum}
        </div>
        {items.length > 0 && (
          <span className="inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-gray-700 text-gray-300">
            {items.length}
          </span>
        )}
      </div>

      {/* Items */}
      <div className="space-y-1">
        {items.slice(0, MAX_VISIBLE).map((item) => (
          <div
            key={item.id}
            className={`text-xs truncate ${
              item.isOverdue
                ? 'text-red-400'
                : item.type === 'calendar'
                  ? 'text-blue-400'
                  : item.type === 'commitment'
                    ? 'text-purple-400'
                    : past
                      ? 'text-gray-600'
                      : 'text-gray-300'
            }`}
            title={item.title}
          >
            {item.isOverdue && (
              <span className="mr-0.5" aria-label="overdue">
                &#x26A0;&#xFE0F;
              </span>
            )}
            {item.type === 'calendar' && (
              <svg className="inline-block w-3 h-3 mr-0.5 -mt-px" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 011 1v3a1 1 0 01-2 0V8a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
            )}
            {item.time ? `${item.time} — ${item.title}` : item.title}
          </div>
        ))}
        {overflow > 0 && (
          <div className="text-[10px] text-gray-500">+{overflow} more</div>
        )}
      </div>
    </div>
  );
}

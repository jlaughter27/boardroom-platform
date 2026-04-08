import { Badge } from '../ui';

export interface DayItem {
  id: string;
  title: string;
  type: 'task' | 'commitment' | 'calendar';
  isOverdue: boolean;
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
        isToday ? 'ring-1 ring-primary rounded-md bg-primary/10' : ''
      }`}
    >
      <div className="text-center mb-2">
        <div className={`text-xs ${past ? 'text-muted-foreground' : 'text-muted-foreground'}`}>
          {dayName}
        </div>
        <div
          className={`text-lg font-bold ${
            isToday ? 'text-primary' : past ? 'text-muted-foreground' : 'text-foreground'
          }`}
        >
          {dayNum}
        </div>
        {items.length > 0 && (
          <Badge variant="default" className="mt-0.5 text-[10px]">
            {items.length}
          </Badge>
        )}
      </div>

      <div className="space-y-1">
        {items.slice(0, MAX_VISIBLE).map((item) => (
          <div
            key={item.id}
            className={`text-xs truncate ${
              item.isOverdue
                ? 'text-destructive'
                : item.type === 'calendar'
                  ? 'text-info'
                  : item.type === 'commitment'
                    ? 'text-primary'
                    : past
                      ? 'text-muted-foreground'
                      : 'text-muted-foreground'
            }`}
            title={item.title}
          >
            {item.isOverdue && <span className="mr-0.5">{'\u26A0'}</span>}
            {item.time ? `${item.time} \u2014 ${item.title}` : item.title}
          </div>
        ))}
        {overflow > 0 && (
          <div className="text-[10px] text-muted-foreground">+{overflow} more</div>
        )}
      </div>

      {items.length === 0 && (
        <div className="h-8 border border-dashed border-border rounded-sm" />
      )}
    </div>
  );
}

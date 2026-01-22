import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import Papa from "papaparse";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import world from "@svg-maps/world";
import { countries, continents } from "countries-list";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import "./App.css";

// Shape of one row in diary.csv
type DiaryRow = {
  Date: string;
  Name: string;
  Year: string;
  "Letterboxd URI": string;
  Rating: string;
  Rewatch: string;
  Tags: string;
  "Watched Date": string;
};

// Shape of one row in reviews.csv
type ReviewRow = {
  Date: string;
  Name: string;
  Year: string;
  "Letterboxd URI": string;
  Rating: string;
  Rewatch: string;
  Review: string;
  Tags: string;
  "Watched Date": string;
};

type FilmSummary = {
  key: string;
  name: string;
  year: string;
  entryCount: number;   // how many diary rows for this film
  hasRewatch: boolean;  // did you ever mark it as a rewatch?
};

type DateFilter = "all" | string;

// Shape of one row in watchlist.csv
type WatchlistRow = {
  Date: string;
  Name: string;
  Year: string;
  "Letterboxd URI": string;
};

// Enriched watchlist movie with criteria flags
type WatchlistMovie = {
  name: string;
  year: string;
  uri: string;
  director: string;
  runtime: number | null; // in minutes
  continents: string[];
  directedByWoman: boolean;
  writtenByWoman: boolean;
  notAmerican: boolean;
  notEnglish: boolean;
  inCriterion: boolean;
  criteriaCount: number;
};

// Runtime filter options
type RuntimeFilter = "all" | "under90" | "under2h" | "under2.5h" | "over2.5h";

// Sort state for watchlist columns
type WatchlistSortState = "default" | "asc" | "desc";
type WatchlistSortColumn = "name" | "director" | "year" | "runtime" | null;
type DecadeFilter = { type: "decade" | "offset"; label: string } | null;
type GeoFilter = { type: "continent" | "country"; value: string } | null;
type GeoView = "continent" | "country";
const CONTINENT_ORDER = ["AF", "AS", "EU", "NA", "SA", "OC", "AN"] as const;

const getContinentCode = (countryCode: string | undefined | null) => {
  if (!countryCode) return null;
  const upper = countryCode.toUpperCase();
  const entry = (countries as Record<string, any>)[upper];
  return entry?.continent || null;
};

const getContinentLabel = (code: string) =>
  (continents as Record<string, string>)[code] || code;

const sortMoviesByColumn = <T extends Record<string, any>>(
  items: T[],
  column: WatchlistSortColumn,
  state: WatchlistSortState
) => {
  if (!column || state === "default") return items;

  return [...items].sort((a, b) => {
    let aVal = a[column];
    let bVal = b[column];
    // Handle null/undefined values
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    // Case-insensitive string comparison
    if (typeof aVal === "string") aVal = aVal.toLowerCase();
    if (typeof bVal === "string") bVal = bVal.toLowerCase();
    if (aVal < bVal) return state === "asc" ? -1 : 1;
    if (aVal > bVal) return state === "asc" ? 1 : -1;
    return 0;
  });
};

const formatRuntime = (runtime: number | null) => {
  if (!runtime) return "—";
  const h = Math.floor(runtime / 60);
  const m = runtime % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

// Cute loading spinner component
const LoadingSpinner = ({ message }: { message?: string }) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", padding: "24px" }}>
    <div style={{ position: "relative", width: "48px", height: "48px" }}>
      {/* Outer ring */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          border: "3px solid #456",
          borderTopColor: "#00e054",
          borderRadius: "50%",
          animation: "spin 1s linear infinite",
        }}
      />
      {/* Inner ring */}
      <div
        style={{
          position: "absolute",
          inset: "8px",
          border: "3px solid #345",
          borderBottomColor: "#00e054",
          borderRadius: "50%",
          animation: "spin 0.6s linear infinite reverse",
        }}
      />
    </div>
    {message && (
      <p style={{ color: "#9ab", fontSize: "14px", textAlign: "center" }}>{message}</p>
    )}
    <style>{`
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `}</style>
  </div>
);

const RatingTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || payload.length === 0) return null;

  const count = payload[0].value as number;

  return (
    <div
      style={{
        fontSize: "12px",
        color: "#9ab",
        backgroundColor: "rgba(20, 24, 28, 0.95)",
        border: "1px solid #345",
        borderRadius: "4px",
        padding: "6px 10px",
        boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
      }}
    >
      <div style={{ fontWeight: 600, color: "#fff", marginBottom: "2px" }}>{label}★</div>
      <div>
        {count} {count === 1 ? "entry" : "entries"}
      </div>
    </div>
  );
};

// Letterboxd-style pie chart colors
const PIE_COLORS = {
  primary: "#00e054",    // Letterboxd green
  secondary: "#456",     // Muted slate for "other" segment
};

const shouldLogDebug = () =>
  import.meta.env.DEV && typeof window !== "undefined" && (window as any).DEBUG_TMDB;

const logDebug = (...args: any[]) => {
  if (shouldLogDebug()) {
    console.log(...args);
  }
};

const PieTooltip = ({ active, payload }: any) => {
  if (!active || !payload || payload.length === 0) return null;

  const { name, value } = payload[0];
  const total = payload[0].payload.total;
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;

  return (
    <div
      style={{
        fontSize: "12px",
        color: "#9ab",
        backgroundColor: "rgba(20, 24, 28, 0.95)",
        border: "1px solid #345",
        borderRadius: "4px",
        padding: "6px 10px",
        boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
      }}
    >
      <div style={{ fontWeight: 600, color: "#fff", marginBottom: "2px" }}>{name}</div>
      <div>
        {value} {value === 1 ? "film" : "films"} ({percent}%)
      </div>
    </div>
  );
};

type StatPieChartProps = {
  primaryValue: number;
  primaryLabel: string;
  secondaryValue: number;
  secondaryLabel: string;
  size?: number;
  onClick?: () => void;
  isSelected?: boolean;
};

const StatPieChart = ({
  primaryValue,
  primaryLabel,
  secondaryValue,
  secondaryLabel,
  size = 140,
  onClick,
  isSelected = false,
}: StatPieChartProps) => {
  const total = primaryValue + secondaryValue;
  const primaryPercent = total > 0 ? Math.round((primaryValue / total) * 100) : 0;
  const secondaryPercent = total > 0 ? Math.round((secondaryValue / total) * 100) : 0;

  const data = [
    { name: primaryLabel, value: primaryValue, total },
    { name: secondaryLabel, value: secondaryValue, total },
  ];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        cursor: onClick ? "pointer" : "default",
        padding: "8px",
        borderRadius: "8px",
        backgroundColor: isSelected ? "rgba(0, 224, 84, 0.1)" : "transparent",
        border: isSelected ? "2px solid #00e054" : "2px solid transparent",
        transition: "all 0.2s ease",
      }}
      onClick={onClick}
    >
      {/* Secondary label at top */}
      <div style={{ textAlign: "center", marginBottom: "4px" }}>
        <span style={{ fontSize: "13px", color: "#678" }}>{secondaryLabel}</span>
        <span style={{ fontSize: "13px", color: "#678", marginLeft: "4px" }}>{secondaryPercent}%</span>
      </div>

      {/* Donut chart */}
      <div style={{ width: size, height: size }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={size * 0.35}
              outerRadius={size * 0.48}
              paddingAngle={1}
              dataKey="value"
              startAngle={90}
              endAngle={-270}
              stroke="none"
              isAnimationActive={false}
            >
              <Cell fill={PIE_COLORS.primary} />
              <Cell fill={PIE_COLORS.secondary} />
            </Pie>
            <Tooltip content={<PieTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Primary label at bottom */}
      <div style={{ textAlign: "center", marginTop: "4px" }}>
        <span style={{ fontSize: "13px", fontWeight: 500, color: "#def" }}>{primaryLabel}</span>
        <span style={{ fontSize: "13px", fontWeight: 600, color: "#00e054", marginLeft: "6px" }}>{primaryPercent}%</span>
      </div>
    </div>
  );
};

type VirtualListProps = {
  items: any[];
  height: number;
  itemHeight: number;
  heights?: number[] | null;
  overscan?: number;
  className?: string;
  minWidth?: number | string;
  renderRow: (item: any, index: number, style: React.CSSProperties) => ReactNode;
};

const VirtualList = memo(({ items, height, itemHeight, heights, overscan = 6, className, minWidth, renderRow }: VirtualListProps) => {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const hasHeights = Array.isArray(heights) && heights.length === items.length;
  const offsets = useMemo(() => {
    if (!hasHeights) return null;
    const arr = new Array(items.length + 1);
    arr[0] = 0;
    for (let i = 0; i < items.length; i += 1) {
      arr[i + 1] = arr[i] + (heights?.[i] || itemHeight);
    }
    return arr;
  }, [hasHeights, heights, items.length, itemHeight]);

  const totalHeight = hasHeights && offsets
    ? offsets[offsets.length - 1]
    : items.length * itemHeight;

  const findStartIndex = (value: number) => {
    if (!offsets) return Math.max(0, Math.floor(value / itemHeight));
    let low = 0;
    let high = offsets.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (offsets[mid] <= value) {
        if (offsets[mid + 1] > value) return mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return Math.max(0, Math.min(low, items.length - 1));
  };

  const startIndexRaw = findStartIndex(scrollTop);
  const endIndexRaw = findStartIndex(scrollTop + height) + 1;
  const startIndex = Math.max(0, startIndexRaw - overscan);
  const endIndex = Math.min(items.length, endIndexRaw + overscan);

  return (
      <div
        className={className}
        style={{ height, overflowY: "auto", overflowX: "hidden", position: "relative", width: "100%" }}
        ref={containerRef}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onWheel={(event) => {
        const el = containerRef.current;
        if (!el) return;
        const atTop = el.scrollTop <= 0;
        const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
        if ((event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <div style={{ height: totalHeight, position: "relative", width: "100%", minWidth }}>
        {items.slice(startIndex, endIndex).map((item, idx) => {
          const index = startIndex + idx;
          const top = offsets ? offsets[index] : index * itemHeight;
          const heightValue = heights?.[index] || itemHeight;
          return renderRow(item, index, {
            position: "absolute",
            top,
            left: 0,
            height: heightValue,
            width: "100%",
          });
        })}
      </div>
    </div>
  );
});

const HEAT_COLORS = ["#1c232a", "#21462c", "#2f6f3a", "#3fbf5a", "#00e054"];

type HeatCell = {
  date: Date;
  dateKey: string;
  count: number;
  inYear: boolean;
};

const buildYearHeatmap = (year: number, counts?: Map<string, number>) => {
  const start = new Date(year, 0, 1);
  const today = new Date();
  const isCurrentYear = today.getFullYear() === year;
  const end = isCurrentYear ? new Date(today.getFullYear(), today.getMonth(), today.getDate()) : new Date(year, 11, 31);

  const startSunday = new Date(start);
  startSunday.setDate(start.getDate() - start.getDay());

  const endSaturday = new Date(end);
  endSaturday.setDate(end.getDate() + (6 - end.getDay()));

  const weeks: HeatCell[][] = [];
  const monthLabels: Array<{ index: number; label: string }> = [];
  let current = new Date(startSunday);
  let weekIndex = 0;
  let maxCount = 0;

  while (current <= endSaturday) {
    const week: HeatCell[] = [];
    for (let i = 0; i < 7; i += 1) {
      const dateKey = current.toISOString().slice(0, 10);
      const count = counts?.get(dateKey) || 0;
      if (count > maxCount) maxCount = count;
      week.push({
        date: new Date(current),
        dateKey,
        count,
        inYear: current.getFullYear() === year,
      });
      current.setDate(current.getDate() + 1);
    }
    weeks.push(week);

    const dayOfMonth = week[0].date.getDate();
    if (week[0].date.getFullYear() === year && dayOfMonth <= 7) {
      const label = week[0].date.toLocaleString("en-US", { month: "short" });
      monthLabels.push({ index: weekIndex, label });
    }
    weekIndex += 1;
  }

  return { weeks, monthLabels, maxCount };
};

const getHeatColor = (count: number, maxCount: number) => {
  if (count <= 0) return HEAT_COLORS[0];
  if (maxCount <= 1) return HEAT_COLORS[4];
  const ratio = count / maxCount;
  if (ratio < 0.34) return HEAT_COLORS[1];
  if (ratio < 0.67) return HEAT_COLORS[2];
  if (ratio < 0.9) return HEAT_COLORS[3];
  return HEAT_COLORS[4];
};

const getOrdinal = (day: number) => {
  const mod10 = day % 10;
  const mod100 = day % 100;
  if (mod10 === 1 && mod100 !== 11) return "st";
  if (mod10 === 2 && mod100 !== 12) return "nd";
  if (mod10 === 3 && mod100 !== 13) return "rd";
  return "th";
};

const formatHeatmapLabel = (date: Date, count: number) => {
  const month = date.toLocaleDateString("en-US", { month: "long" });
  const day = date.getDate();
  return `${count} movie${count === 1 ? "" : "s"} on ${month} ${day}${getOrdinal(day)}`;
};

type HeatmapYearProps = {
  year: string;
  counts?: Map<string, number>;
  compact?: boolean;
  onHoverCell?: (label: string, x: number, y: number) => void;
  onLeaveCell?: () => void;
};

const HeatmapYear = memo(({ year, counts, compact = false, onHoverCell, onLeaveCell }: HeatmapYearProps) => {
  const { weeks, monthLabels, maxCount } = useMemo(
    () => buildYearHeatmap(parseInt(year, 10), counts),
    [year, counts]
  );
  const weeksCount = weeks.length;

  return (
    <div
      className={`lb-heatmap-year ${compact ? "is-compact" : ""}`}
      style={{ ["--lb-heatmap-weeks" as any]: weeksCount }}
    >
      <div className="lb-heatmap-year-title">{year}</div>
      <div className="lb-heatmap-grid-wrap">
        <div className="lb-heatmap-months">
          {monthLabels.map((m) => (
            <span key={`${year}-${m.label}-${m.index}`} style={{ gridColumnStart: m.index + 1 }}>
              {m.label}
            </span>
          ))}
        </div>
        <div className="lb-heatmap-grid">
          {weeks.map((week, weekIdx) => (
            <div key={`${year}-w-${weekIdx}`} className="lb-heatmap-week">
              {week.map((cell) => (
                <div
                  key={cell.dateKey}
                  className={`lb-heatmap-cell ${cell.inYear ? "" : "is-muted"}`}
                  style={{ backgroundColor: cell.inYear ? getHeatColor(cell.count, maxCount) : "#151b20" }}
                  onMouseEnter={(event) => {
                    if (!onHoverCell) return;
                    onHoverCell(formatHeatmapLabel(cell.date, cell.count), event.clientX, event.clientY);
                  }}
                  onMouseMove={(event) => {
                    if (!onHoverCell) return;
                    onHoverCell(formatHeatmapLabel(cell.date, cell.count), event.clientX, event.clientY);
                  }}
                  onMouseLeave={() => {
                    if (!onLeaveCell) return;
                    onLeaveCell();
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      {!compact && (
        <div className="lb-heatmap-legend">
          <span>Less</span>
          {HEAT_COLORS.map((color, idx) => (
            <span key={`${year}-legend-${idx}`} className="lb-heatmap-legend-swatch" style={{ backgroundColor: color }} />
          ))}
          <span>More</span>
        </div>
      )}
    </div>
  );
});

type DiaryMovie = {
  name: string;
  year: string;
  uri: string;
  director: string;
  runtime: number | null;
  directedByWoman: boolean;
  writtenByWoman: boolean;
  notAmerican: boolean;
  notEnglish: boolean;
  inCriterion: boolean;
  criteriaCount: number;
};

type DiaryTableProps = {
  moviesWithData: any[];
  diaryFilters: {
    directedByWoman: boolean;
    writtenByWoman: boolean;
    notAmerican: boolean;
    notEnglish: boolean;
    inCriterion: boolean;
  };
  setDiaryFilters: Dispatch<SetStateAction<{
    directedByWoman: boolean;
    writtenByWoman: boolean;
    notAmerican: boolean;
    notEnglish: boolean;
    inCriterion: boolean;
  }>>;
  diarySortColumn: WatchlistSortColumn;
  setDiarySortColumn: Dispatch<SetStateAction<WatchlistSortColumn>>;
  diarySortState: WatchlistSortState;
  setDiarySortState: Dispatch<SetStateAction<WatchlistSortState>>;
};

const DiaryTable = memo(({
  moviesWithData,
  diaryFilters,
  setDiaryFilters,
  diarySortColumn,
  setDiarySortColumn,
  diarySortState,
  setDiarySortState,
}: DiaryTableProps) => {
  const diaryMovieList = useMemo<DiaryMovie[]>(() => {
    const map = new Map<string, DiaryMovie>();
    for (const movie of moviesWithData) {
      const tmdbData = movie.tmdb_data || {};
      const directors = tmdbData.directors || [];
      const directorNames = directors.map((d: any) => d.name).filter(Boolean).join(", ");
      const name = tmdbData.title || "Unknown Title";
      const year = tmdbData.release_date?.slice(0, 4) || "";
      const key = `${name.toLowerCase()}|${year}`;
      if (map.has(key)) continue;
      map.set(key, {
        name,
        year,
        uri: movie.letterboxd_url || "",
        director: directorNames || "Unknown",
        runtime: typeof tmdbData.runtime === "number" ? tmdbData.runtime : null,
        directedByWoman: tmdbData.directed_by_woman === true,
        writtenByWoman: tmdbData.written_by_woman === true,
        notAmerican: tmdbData.is_american === false,
        notEnglish: tmdbData.is_english === false,
        inCriterion: movie.is_in_criterion_collection === true,
        criteriaCount: [
          tmdbData.directed_by_woman === true,
          tmdbData.written_by_woman === true,
          tmdbData.is_american === false,
          tmdbData.is_english === false,
          movie.is_in_criterion_collection === true,
        ].filter(Boolean).length,
      });
    }
    return Array.from(map.values());
  }, [moviesWithData]);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const hasMeasuredRef = useRef(false);
  const measureSignatureRef = useRef<string>("");
  const [rowHeightsByKey, setRowHeightsByKey] = useState<Record<string, number> | null>(null);
  const estimatedRowHeight = 56;
  const tableScrollRef = useRef<HTMLDivElement | null>(null);

  const getDiaryKey = useCallback((movie: DiaryMovie) => {
    if (movie.uri) return movie.uri;
    return `${movie.name.toLowerCase()}|${movie.year}`;
  }, []);

  const filteredDiaryMovies = useMemo(() => {
    const hasActiveFilter = Object.values(diaryFilters).some(Boolean);
    let filtered = hasActiveFilter
      ? diaryMovieList.filter((movie) => {
          if (diaryFilters.directedByWoman && !movie.directedByWoman) return false;
          if (diaryFilters.writtenByWoman && !movie.writtenByWoman) return false;
          if (diaryFilters.notAmerican && !movie.notAmerican) return false;
          if (diaryFilters.notEnglish && !movie.notEnglish) return false;
          if (diaryFilters.inCriterion && !movie.inCriterion) return false;
          return true;
        })
      : [...diaryMovieList];

    if (diarySortColumn && diarySortState !== "default") {
      filtered = sortMoviesByColumn(filtered, diarySortColumn, diarySortState);
    } else {
      filtered = [...filtered].sort((a, b) => {
        if (b.criteriaCount !== a.criteriaCount) {
          return b.criteriaCount - a.criteriaCount;
        }
        const nameA = (a.name || "").toLowerCase();
        const nameB = (b.name || "").toLowerCase();
        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;
        return 0;
      });
    }

    return filtered;
  }, [diaryFilters, diaryMovieList, diarySortColumn, diarySortState]);

  const hasActiveFilter = Object.values(diaryFilters).some(Boolean);

  const toggleFilter = (key: keyof typeof diaryFilters) => {
    setDiaryFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleSort = (column: WatchlistSortColumn) => {
    if (diarySortColumn !== column) {
      setDiarySortColumn(column);
      setDiarySortState("asc");
    } else {
      if (diarySortState === "asc") {
        setDiarySortState("desc");
      } else if (diarySortState === "desc") {
        setDiarySortState("default");
        setDiarySortColumn(null);
      } else {
        setDiarySortState("asc");
      }
    }
  };

  const getSortIndicator = (column: WatchlistSortColumn) => {
    if (diarySortColumn !== column) return "";
    if (diarySortState === "asc") return " ↑";
    if (diarySortState === "desc") return " ↓";
    return "";
  };

  useLayoutEffect(() => {
    const signature = `${diaryMovieList.length}|${getDiaryKey(diaryMovieList[0] as any || { name: "", year: "", uri: "" })}`;
    if (measureSignatureRef.current !== signature) {
      measureSignatureRef.current = signature;
      hasMeasuredRef.current = false;
      setRowHeightsByKey(null);
    }
    if (hasMeasuredRef.current) return;
    const container = measureRef.current;
    if (!container) return;

    let frame = 0;
    let retry = 0;
    let cancelled = false;

    const measure = () => {
      if (cancelled || hasMeasuredRef.current) return;
      const nodes = Array.from(container.querySelectorAll<HTMLElement>("[data-measure-key]"));
      if (!nodes.length) return;
      const next: Record<string, number> = {};
      nodes.forEach((node) => {
        const key = node.dataset.measureKey;
        if (!key) return;
        const rect = node.getBoundingClientRect();
        if (rect.height) next[key] = Math.ceil(rect.height);
      });
      if (Object.keys(next).length) {
        setRowHeightsByKey(next);
        hasMeasuredRef.current = true;
        return;
      }
      retry += 1;
      if (retry < 3) {
        frame = window.requestAnimationFrame(measure);
      }
    };

    frame = window.requestAnimationFrame(measure);

    if ("fonts" in document && (document as any).fonts?.ready) {
      (document as any).fonts.ready.then(() => {
        if (cancelled || hasMeasuredRef.current) return;
        frame = window.requestAnimationFrame(measure);
      });
    }

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [diaryMovieList, getDiaryKey]);

  const rowHeights = useMemo(() => (
    filteredDiaryMovies.map((movie) => rowHeightsByKey?.[getDiaryKey(movie)] || estimatedRowHeight)
  ), [filteredDiaryMovies, getDiaryKey, rowHeightsByKey, estimatedRowHeight]);
  const diaryListHeight = useMemo(() => {
    const total = rowHeights.reduce((sum, height) => sum + height, 0);
    return Math.min(400, total || 0);
  }, [rowHeights]);

  useEffect(() => {
    if (tableScrollRef.current) {
      tableScrollRef.current.scrollLeft = 0;
    }
  }, [filteredDiaryMovies.length]);

  const renderRow = useCallback((movie: DiaryMovie, index: number, style: React.CSSProperties) => {
    const isAlt = index % 2 === 1;
    return (
      <div
        key={movie.uri || index}
        style={{ ...style, minWidth: "var(--lb-table-min-width)", width: "100%" }}
        className={`lb-row lb-diary-grid ${isAlt ? "lb-row-alt" : ""}`}
      >
        <div className="lb-cell lb-cell-title">
          <a
            href={movie.uri}
            target="_blank"
            rel="noopener noreferrer"
            className="lb-link"
          >
            {movie.name}
          </a>
        </div>
        <div className="lb-cell lb-cell-director">{movie.director}</div>
        <div className="lb-cell lb-cell-center">{movie.year}</div>
        <div className="lb-cell lb-cell-flag" style={{ color: movie.directedByWoman ? "#00e054" : "#456" }}>
          {movie.directedByWoman ? "✓" : "✗"}
        </div>
        <div className="lb-cell lb-cell-flag" style={{ color: movie.writtenByWoman ? "#00e054" : "#456" }}>
          {movie.writtenByWoman ? "✓" : "✗"}
        </div>
        <div className="lb-cell lb-cell-flag" style={{ color: movie.notAmerican ? "#00e054" : "#456" }}>
          {movie.notAmerican ? "✓" : "✗"}
        </div>
        <div className="lb-cell lb-cell-flag" style={{ color: movie.notEnglish ? "#00e054" : "#456" }}>
          {movie.notEnglish ? "✓" : "✗"}
        </div>
        <div className="lb-cell lb-cell-flag" style={{ color: movie.inCriterion ? "#00e054" : "#456" }}>
          {movie.inCriterion ? "✓" : "✗"}
        </div>
      </div>
    );
  }, []);

  return (
    <div style={{ width: "100%", marginTop: "24px" }}>
      <h3 id="diary-list" className="lb-section-title">
        All Films ({filteredDiaryMovies.length}{hasActiveFilter ? ` of ${diaryMovieList.length}` : ""})
      </h3>
      {hasActiveFilter && (
        <p className="lb-filter-row">
          <button
            onClick={() => setDiaryFilters({
              directedByWoman: false,
              writtenByWoman: false,
              notAmerican: false,
              notEnglish: false,
              inCriterion: false,
            })}
            className="lb-filter-clear"
          >
            Clear filters
          </button>
        </p>
      )}
      <div
        className="lb-table-container"
        style={{ ["--lb-table-min-width" as any]: "650px" }}
        ref={tableScrollRef}
      >
        <div className="lb-table-inner">
        <div className="lb-table-head lb-diary-grid">
            <button className="lb-header-cell" title="Click to sort by title" onClick={() => toggleSort("name")}>
              Title{getSortIndicator("name")}
            </button>
            <button className="lb-header-cell" title="Click to sort by director" onClick={() => toggleSort("director")}>
              Director{getSortIndicator("director")}
            </button>
            <button className="lb-header-cell" title="Click to sort by year" onClick={() => toggleSort("year")}>
              Year{getSortIndicator("year")}
            </button>
            <button className={`lb-header-cell lb-header-flag ${diaryFilters.directedByWoman ? "lb-header-active" : ""}`} title="Directed by Woman (click to filter)" onClick={() => toggleFilter("directedByWoman")}>
              Dir♀
            </button>
            <button className={`lb-header-cell lb-header-flag ${diaryFilters.writtenByWoman ? "lb-header-active" : ""}`} title="Written by Woman (click to filter)" onClick={() => toggleFilter("writtenByWoman")}>
              Writ♀
            </button>
            <button className={`lb-header-cell lb-header-flag ${diaryFilters.notAmerican ? "lb-header-active" : ""}`} title="Not American (click to filter)" onClick={() => toggleFilter("notAmerican")}>
              !US
            </button>
            <button className={`lb-header-cell lb-header-flag ${diaryFilters.notEnglish ? "lb-header-active" : ""}`} title="Not in English (click to filter)" onClick={() => toggleFilter("notEnglish")}>
              !EN
            </button>
            <button className={`lb-header-cell lb-header-flag ${diaryFilters.inCriterion ? "lb-header-active" : ""}`} title="Criterion Collection (click to filter)" onClick={() => toggleFilter("inCriterion")}>
              CC
            </button>
          </div>
          <div ref={measureRef} className="lb-measure">
            {diaryMovieList.map((movie, index) => (
              <div
                key={`${getDiaryKey(movie)}-${index}`}
                data-measure-key={getDiaryKey(movie)}
                className="lb-row lb-diary-grid"
              >
                <div className="lb-cell lb-cell-title">{movie.name}</div>
                <div className="lb-cell lb-cell-director">{movie.director}</div>
                <div className="lb-cell lb-cell-center">{movie.year}</div>
                <div className="lb-cell lb-cell-flag">{movie.directedByWoman ? "✓" : "✗"}</div>
                <div className="lb-cell lb-cell-flag">{movie.writtenByWoman ? "✓" : "✗"}</div>
                <div className="lb-cell lb-cell-flag">{movie.notAmerican ? "✓" : "✗"}</div>
                <div className="lb-cell lb-cell-flag">{movie.notEnglish ? "✓" : "✗"}</div>
                <div className="lb-cell lb-cell-flag">{movie.inCriterion ? "✓" : "✗"}</div>
              </div>
            ))}
          </div>
        <VirtualList
          height={diaryListHeight}
          itemHeight={estimatedRowHeight}
          heights={rowHeights}
          items={filteredDiaryMovies}
          renderRow={renderRow}
          className="lb-list"
          minWidth={650}
        />
        </div>
      </div>
    </div>
  );
});

type WatchlistTableProps = {
  watchlistMovies: WatchlistMovie[];
  watchlistFilters: {
    directedByWoman: boolean;
    writtenByWoman: boolean;
    notAmerican: boolean;
    notEnglish: boolean;
    inCriterion: boolean;
  };
  setWatchlistFilters: Dispatch<SetStateAction<{
    directedByWoman: boolean;
    writtenByWoman: boolean;
    notAmerican: boolean;
    notEnglish: boolean;
    inCriterion: boolean;
  }>>;
  watchlistRuntimeFilter: RuntimeFilter;
  setWatchlistRuntimeFilter: Dispatch<SetStateAction<RuntimeFilter>>;
  watchlistSortColumn: WatchlistSortColumn;
  setWatchlistSortColumn: Dispatch<SetStateAction<WatchlistSortColumn>>;
  watchlistSortState: WatchlistSortState;
  setWatchlistSortState: Dispatch<SetStateAction<WatchlistSortState>>;
  watchlistContinentFilter: string | null;
  setWatchlistContinentFilter: Dispatch<SetStateAction<string | null>>;
};

const WatchlistTable = memo(({
  watchlistMovies,
  watchlistFilters,
  setWatchlistFilters,
  watchlistRuntimeFilter,
  setWatchlistRuntimeFilter,
  watchlistSortColumn,
  setWatchlistSortColumn,
  watchlistSortState,
  setWatchlistSortState,
  watchlistContinentFilter,
  setWatchlistContinentFilter,
}: WatchlistTableProps) => {
  const measureRef = useRef<HTMLDivElement | null>(null);
  const hasMeasuredRef = useRef(false);
  const measureSignatureRef = useRef<string>("");
  const [rowHeightsByKey, setRowHeightsByKey] = useState<Record<string, number> | null>(null);
  const estimatedRowHeight = 56;
  const tableScrollRef = useRef<HTMLDivElement | null>(null);

  const getWatchlistKey = useCallback((movie: WatchlistMovie) => movie.uri, []);

  const passesRuntimeFilter = useCallback((runtime: number | null) => {
    if (watchlistRuntimeFilter === "all") return true;
    if (runtime === null) return false;
    if (watchlistRuntimeFilter === "under90") return runtime < 90;
    if (watchlistRuntimeFilter === "under2h") return runtime < 120;
    if (watchlistRuntimeFilter === "under2.5h") return runtime < 150;
    if (watchlistRuntimeFilter === "over2.5h") return runtime >= 150;
    return true;
  }, [watchlistRuntimeFilter]);

  const filteredMovies = useMemo(() => {
    const hasActiveFilter = Object.values(watchlistFilters).some(Boolean);
    const hasActiveContinentFilter = watchlistContinentFilter !== null;
    let filtered = watchlistMovies.filter((movie) => {
      if (hasActiveFilter) {
        if (watchlistFilters.directedByWoman && !movie.directedByWoman) return false;
        if (watchlistFilters.writtenByWoman && !movie.writtenByWoman) return false;
        if (watchlistFilters.notAmerican && !movie.notAmerican) return false;
        if (watchlistFilters.notEnglish && !movie.notEnglish) return false;
        if (watchlistFilters.inCriterion && !movie.inCriterion) return false;
      }
      if (hasActiveContinentFilter && watchlistContinentFilter && !movie.continents.includes(watchlistContinentFilter)) {
        return false;
      }
      if (!passesRuntimeFilter(movie.runtime)) return false;
      return true;
    });

    filtered = sortMoviesByColumn(filtered, watchlistSortColumn, watchlistSortState);
    return filtered;
  }, [passesRuntimeFilter, watchlistContinentFilter, watchlistFilters, watchlistMovies, watchlistSortColumn, watchlistSortState]);

  const hasActiveFilter = Object.values(watchlistFilters).some(Boolean);
  const hasActiveRuntimeFilter = watchlistRuntimeFilter !== "all";
  const hasActiveContinentFilter = watchlistContinentFilter !== null;
  const hasAnyFilter = hasActiveFilter || hasActiveRuntimeFilter || hasActiveContinentFilter;

  const toggleFilter = (key: keyof typeof watchlistFilters) => {
    setWatchlistFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleSort = (column: WatchlistSortColumn) => {
    if (watchlistSortColumn !== column) {
      setWatchlistSortColumn(column);
      setWatchlistSortState("asc");
    } else {
      if (watchlistSortState === "asc") {
        setWatchlistSortState("desc");
      } else if (watchlistSortState === "desc") {
        setWatchlistSortState("default");
        setWatchlistSortColumn(null);
      } else {
        setWatchlistSortState("asc");
      }
    }
  };

  const getSortIndicator = (column: WatchlistSortColumn) => {
    if (watchlistSortColumn !== column) return "";
    if (watchlistSortState === "asc") return " ↑";
    if (watchlistSortState === "desc") return " ↓";
    return "";
  };

  useLayoutEffect(() => {
    const signature = `${watchlistMovies.length}|${watchlistMovies[0]?.uri || ""}`;
    if (measureSignatureRef.current !== signature) {
      measureSignatureRef.current = signature;
      hasMeasuredRef.current = false;
      setRowHeightsByKey(null);
    }
    if (hasMeasuredRef.current) return;
    const container = measureRef.current;
    if (!container) return;

    let frame = 0;
    let retry = 0;
    let cancelled = false;

    const measure = () => {
      if (cancelled || hasMeasuredRef.current) return;
      const nodes = Array.from(container.querySelectorAll<HTMLElement>("[data-measure-key]"));
      if (!nodes.length) return;
      const next: Record<string, number> = {};
      nodes.forEach((node) => {
        const key = node.dataset.measureKey;
        if (!key) return;
        const rect = node.getBoundingClientRect();
        if (rect.height) next[key] = Math.ceil(rect.height);
      });
      if (Object.keys(next).length) {
        setRowHeightsByKey(next);
        hasMeasuredRef.current = true;
        return;
      }
      retry += 1;
      if (retry < 3) {
        frame = window.requestAnimationFrame(measure);
      }
    };

    frame = window.requestAnimationFrame(measure);

    if ("fonts" in document && (document as any).fonts?.ready) {
      (document as any).fonts.ready.then(() => {
        if (cancelled || hasMeasuredRef.current) return;
        frame = window.requestAnimationFrame(measure);
      });
    }

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [getWatchlistKey, watchlistMovies]);

  const rowHeights = useMemo(() => (
    filteredMovies.map((movie) => rowHeightsByKey?.[getWatchlistKey(movie)] || estimatedRowHeight)
  ), [filteredMovies, getWatchlistKey, rowHeightsByKey, estimatedRowHeight]);
  const watchlistListHeight = useMemo(() => {
    const total = rowHeights.reduce((sum, height) => sum + height, 0);
    return Math.min(500, total || 0);
  }, [rowHeights]);

  useEffect(() => {
    if (tableScrollRef.current) {
      tableScrollRef.current.scrollLeft = 0;
    }
  }, [filteredMovies.length]);

  const cycleContinentFilter = () => {
    if (!watchlistContinentFilter) {
      setWatchlistContinentFilter(CONTINENT_ORDER[0]);
      return;
    }
    const idx = CONTINENT_ORDER.indexOf(watchlistContinentFilter as (typeof CONTINENT_ORDER)[number]);
    if (idx === -1 || idx === CONTINENT_ORDER.length - 1) {
      setWatchlistContinentFilter(null);
      return;
    }
    setWatchlistContinentFilter(CONTINENT_ORDER[idx + 1]);
  };

  const renderRow = useCallback((movie: WatchlistMovie, index: number, style: React.CSSProperties) => {
    const isAlt = index % 2 === 1;
    return (
      <div
        key={movie.uri}
        style={{ ...style, minWidth: "var(--lb-table-min-width)", width: "100%" }}
        className={`lb-row lb-watchlist-grid ${isAlt ? "lb-row-alt" : ""}`}
      >
        <div className="lb-cell lb-cell-title">
          <a
            href={movie.uri}
            target="_blank"
            rel="noopener noreferrer"
            className="lb-link"
          >
            {movie.name}
          </a>
        </div>
        <div className="lb-cell lb-cell-director">{movie.director}</div>
        <div className="lb-cell lb-cell-center">{movie.year}</div>
        <div className="lb-cell lb-cell-center lb-cell-small">{formatRuntime(movie.runtime)}</div>
        <div className="lb-cell lb-cell-center lb-cell-small">
          {movie.continents.length > 0 ? movie.continents.map(getContinentLabel).join(", ") : "—"}
        </div>
        <div className="lb-cell lb-cell-flag" style={{ color: movie.directedByWoman ? "#00e054" : "#456" }}>
          {movie.directedByWoman ? "✓" : "✗"}
        </div>
        <div className="lb-cell lb-cell-flag" style={{ color: movie.writtenByWoman ? "#00e054" : "#456" }}>
          {movie.writtenByWoman ? "✓" : "✗"}
        </div>
        <div className="lb-cell lb-cell-flag" style={{ color: movie.notAmerican ? "#00e054" : "#456" }}>
          {movie.notAmerican ? "✓" : "✗"}
        </div>
        <div className="lb-cell lb-cell-flag" style={{ color: movie.notEnglish ? "#00e054" : "#456" }}>
          {movie.notEnglish ? "✓" : "✗"}
        </div>
        <div className="lb-cell lb-cell-flag" style={{ color: movie.inCriterion ? "#00e054" : "#456" }}>
          {movie.inCriterion ? "✓" : "✗"}
        </div>
      </div>
    );
  }, []);

  return (
    <div style={{ overflowX: "auto" }}>
      <div className="lb-runtime-filters">
        <span className="lb-runtime-label">Runtime:</span>
        <button className={`lb-runtime-btn ${watchlistRuntimeFilter === "all" ? "is-active" : ""}`} onClick={() => setWatchlistRuntimeFilter("all")}>
          All
        </button>
        <button className={`lb-runtime-btn ${watchlistRuntimeFilter === "under90" ? "is-active" : ""}`} onClick={() => setWatchlistRuntimeFilter("under90")}>
          Under 90 min
        </button>
        <button className={`lb-runtime-btn ${watchlistRuntimeFilter === "under2h" ? "is-active" : ""}`} onClick={() => setWatchlistRuntimeFilter("under2h")}>
          Under 2 hrs
        </button>
        <button className={`lb-runtime-btn ${watchlistRuntimeFilter === "under2.5h" ? "is-active" : ""}`} onClick={() => setWatchlistRuntimeFilter("under2.5h")}>
          Under 2½ hrs
        </button>
        <button className={`lb-runtime-btn ${watchlistRuntimeFilter === "over2.5h" ? "is-active" : ""}`} onClick={() => setWatchlistRuntimeFilter("over2.5h")}>
          Over 2½ hrs
        </button>
      </div>

      {hasAnyFilter && (
        <p className="lb-filter-row">
          Showing {filteredMovies.length} of {watchlistMovies.length} movies
          <button
            onClick={() => {
              setWatchlistFilters({
                directedByWoman: false,
                writtenByWoman: false,
                notAmerican: false,
                notEnglish: false,
                inCriterion: false,
              });
              setWatchlistRuntimeFilter("all");
              setWatchlistContinentFilter(null);
            }}
            className="lb-filter-clear"
          >
            Clear all filters
          </button>
        </p>
      )}

      <div
        className="lb-table-container"
        style={{ ["--lb-table-min-width" as any]: "840px" }}
        ref={tableScrollRef}
      >
        <div className="lb-table-inner">
        <div className="lb-table-head lb-watchlist-grid">
            <button className="lb-header-cell" title="Click to sort by title" onClick={() => toggleSort("name")}>
              Title{getSortIndicator("name")}
            </button>
            <button className="lb-header-cell" title="Click to sort by director" onClick={() => toggleSort("director")}>
              Director{getSortIndicator("director")}
            </button>
            <button className="lb-header-cell" title="Click to sort by year" onClick={() => toggleSort("year")}>
              Year{getSortIndicator("year")}
            </button>
            <button className="lb-header-cell" title="Click to sort by runtime" onClick={() => toggleSort("runtime")}>
              Time{getSortIndicator("runtime")}
            </button>
            <button className={`lb-header-cell lb-header-continent ${watchlistContinentFilter ? "lb-header-active" : ""}`} title="Click to cycle continent filter" onClick={cycleContinentFilter}>
              <div className="lb-header-continent-labels">
                <span>Cont</span>
                <span className="lb-header-sub">{watchlistContinentFilter ? getContinentLabel(watchlistContinentFilter) : "All"}</span>
              </div>
            </button>
            <button className={`lb-header-cell lb-header-flag ${watchlistFilters.directedByWoman ? "lb-header-active" : ""}`} title="Directed by Woman (click to filter)" onClick={() => toggleFilter("directedByWoman")}>
              Dir♀
            </button>
            <button className={`lb-header-cell lb-header-flag ${watchlistFilters.writtenByWoman ? "lb-header-active" : ""}`} title="Written by Woman (click to filter)" onClick={() => toggleFilter("writtenByWoman")}>
              Writ♀
            </button>
            <button className={`lb-header-cell lb-header-flag ${watchlistFilters.notAmerican ? "lb-header-active" : ""}`} title="Not American (click to filter)" onClick={() => toggleFilter("notAmerican")}>
              !US
            </button>
            <button className={`lb-header-cell lb-header-flag ${watchlistFilters.notEnglish ? "lb-header-active" : ""}`} title="Not in English (click to filter)" onClick={() => toggleFilter("notEnglish")}>
              !EN
            </button>
            <button className={`lb-header-cell lb-header-flag ${watchlistFilters.inCriterion ? "lb-header-active" : ""}`} title="Criterion Collection (click to filter)" onClick={() => toggleFilter("inCriterion")}>
              CC
            </button>
          </div>
          <div ref={measureRef} className="lb-measure">
            {watchlistMovies.map((movie) => (
              <div
                key={movie.uri}
                data-measure-key={getWatchlistKey(movie)}
                className="lb-row lb-watchlist-grid"
              >
                <div className="lb-cell lb-cell-title">{movie.name}</div>
                <div className="lb-cell lb-cell-director">{movie.director}</div>
                <div className="lb-cell lb-cell-center">{movie.year}</div>
                <div className="lb-cell lb-cell-center lb-cell-small">{formatRuntime(movie.runtime)}</div>
                <div className="lb-cell lb-cell-center lb-cell-small">
                  {movie.continents.length > 0 ? movie.continents.map(getContinentLabel).join(", ") : "—"}
                </div>
                <div className="lb-cell lb-cell-flag">{movie.directedByWoman ? "✓" : "✗"}</div>
                <div className="lb-cell lb-cell-flag">{movie.writtenByWoman ? "✓" : "✗"}</div>
                <div className="lb-cell lb-cell-flag">{movie.notAmerican ? "✓" : "✗"}</div>
                <div className="lb-cell lb-cell-flag">{movie.notEnglish ? "✓" : "✗"}</div>
                <div className="lb-cell lb-cell-flag">{movie.inCriterion ? "✓" : "✗"}</div>
              </div>
            ))}
          </div>
        <VirtualList
          height={watchlistListHeight}
          itemHeight={estimatedRowHeight}
          heights={rowHeights}
          items={filteredMovies}
          renderRow={renderRow}
          className="lb-list"
          minWidth={840}
        />
        </div>
      </div>
    </div>
  );
});

function App() {
  const [rows, setRows] = useState<DiaryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [movieIndex, setMovieIndex] = useState<Record<string, any> | null>(null);
  const [uriMap, setUriMap] = useState<Record<string, string> | null>(null);
  const [scrapeStatus, setScrapeStatus] = useState<string | null>(null);
  const [scrapeProgress, setScrapeProgress] = useState<{ current: number; total: number } | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [diaryUseVercelApi, setDiaryUseVercelApi] = useState<boolean>(() =>
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
  );

  // Reviews state
  const [reviews, setReviews] = useState<ReviewRow[]>([]);

  // Watchlist state
  const [watchlistMovies, setWatchlistMovies] = useState<WatchlistMovie[]>([]);
  const [watchlistStatus, setWatchlistStatus] = useState<string | null>(null);
  const [watchlistProgress, setWatchlistProgress] = useState<{ current: number; total: number } | null>(null);
  const [isWatchlistLoading, setIsWatchlistLoading] = useState<boolean>(false);
  const [watchlistFilters, setWatchlistFilters] = useState<{
    directedByWoman: boolean;
    writtenByWoman: boolean;
    notAmerican: boolean;
    notEnglish: boolean;
    inCriterion: boolean;
  }>({
    directedByWoman: false,
    writtenByWoman: false,
    notAmerican: false,
    notEnglish: false,
    inCriterion: false,
  });
  const [watchlistSortColumn, setWatchlistSortColumn] = useState<WatchlistSortColumn>(null);
  const [watchlistSortState, setWatchlistSortState] = useState<WatchlistSortState>("default");
  const [watchlistRuntimeFilter, setWatchlistRuntimeFilter] = useState<RuntimeFilter>("all");
  const [watchlistContinentFilter, setWatchlistContinentFilter] = useState<string | null>(null);
  const [watchlistUseVercelApi, setWatchlistUseVercelApi] = useState<boolean>(() =>
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
  );
  const [watchlistMissingCount, setWatchlistMissingCount] = useState<number>(0);
  const [watchlistMissingSamples, setWatchlistMissingSamples] = useState<WatchlistRow[]>([]);
  const [watchlistMissingDebug, setWatchlistMissingDebug] = useState<Array<{
    name: string;
    year: string;
    originalUri: string;
    resolvedUri: string;
    canonicalUri: string;
    foundInLookup: boolean;
    hadUriMap: boolean;
    tmdbId?: number | null;
    tmdbError?: string | null;
  }>>([]);
  const [watchlistUriMapSize, setWatchlistUriMapSize] = useState<number>(0);
  const [diaryFileName, setDiaryFileName] = useState<string>("No file selected");
  const [watchlistFileName, setWatchlistFileName] = useState<string>("No file selected");
  const [reviewsFileName, setReviewsFileName] = useState<string>("No file selected");
  const [isDiaryFormat, setIsDiaryFormat] = useState<boolean>(true);

  // Diary table state (for Film Breakdown section)
  const [diaryFilters, setDiaryFilters] = useState<{
    directedByWoman: boolean;
    writtenByWoman: boolean;
    notAmerican: boolean;
    notEnglish: boolean;
    inCriterion: boolean;
  }>({
    directedByWoman: false,
    writtenByWoman: false,
    notAmerican: false,
    notEnglish: false,
    inCriterion: false,
  });
  const [diarySortColumn, setDiarySortColumn] = useState<WatchlistSortColumn>(null);
  const [diarySortState, setDiarySortState] = useState<WatchlistSortState>("default");
  const [decadeHover, setDecadeHover] = useState<{ label: string; count: number; percent: number; midPercent: number } | null>(null);
  const [offsetDecadeHover, setOffsetDecadeHover] = useState<{ label: string; count: number; percent: number; midPercent: number } | null>(null);
  const [ratingFilter, setRatingFilter] = useState<string | null>(null);
  const [decadeFilter, setDecadeFilter] = useState<DecadeFilter>(null);
  const [geoFilter, setGeoFilter] = useState<GeoFilter>(null);
  const [geoView, setGeoView] = useState<GeoView>("continent");
  const [geoHover, setGeoHover] = useState<{ label: string; count: number; x: number; y: number } | null>(null);
  const mapWrapperRef = useRef<HTMLDivElement | null>(null);
  const heatmapScrollRef = useRef<HTMLDivElement | null>(null);
  const [heatmapTooltip, setHeatmapTooltip] = useState<{ text: string; x: number; y: number; align: "left" | "center" | "right" } | null>(null);

  async function buildMovieIndex(file: File) {
    setScrapeStatus("Starting TMDb scraping…");
    setScrapeProgress(null);
    setMovieIndex(null);
    setUriMap(null);

    // Detect environment: use local server in dev, relative URL in production
    const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const useRemoteApi = isLocalHost && diaryUseVercelApi;
    const baseUrl = useRemoteApi ? 'https://letterbddy.vercel.app' : isLocalHost ? 'http://localhost:5050' : '';

    let json: any;

    if (isLocalHost && !useRemoteApi) {
      // Local development: use the Express server with job polling
      const form = new FormData();
      form.append("file", file);

      const apiUrl = `${baseUrl}/api/movies?enrich=1`;
      const startRes = await fetch(apiUrl, {
        method: "POST",
        body: form,
      });

      if (!startRes.ok) {
        const text = await startRes.text();
        throw new Error(text || `Server error (${startRes.status})`);
      }

      const { jobId } = await startRes.json();

      while (true) {
        const statusRes = await fetch(`${baseUrl}/api/movies/${jobId}/status`);
        if (!statusRes.ok) {
          const text = await statusRes.text();
          throw new Error(text || `Status error (${statusRes.status})`);
        }

        const status = await statusRes.json();

        if (status.state === "error") {
          throw new Error(status.error || "Scraping failed");
        }

        if (typeof status.current === "number" && typeof status.total === "number" && status.total > 0) {
          setScrapeProgress({ current: status.current, total: status.total });
          setScrapeStatus(`Scraping TMDb IDs… ${status.current}/${status.total}`);
        } else {
          setScrapeStatus(status.message || "Working…");
        }

        if (status.state === "done") break;

        await new Promise((r) => setTimeout(r, 750));
      }

      const resultRes = await fetch(`${baseUrl}/api/movies/${jobId}/result`);
      if (!resultRes.ok) {
        const text = await resultRes.text();
        throw new Error(text || `Result error (${resultRes.status})`);
      }

      json = await resultRes.json();
    } else {
      // Production (Vercel): two-phase approach
      // Phase 1: Parse CSV and resolve shortlinks
      setScrapeStatus("Parsing CSV...");

      const csvContent = await file.text();
      const parseResponse = await fetch(`${baseUrl}/api/movies?parse_only=1`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: csvContent,
      });

      if (!parseResponse.ok) {
        throw new Error(await parseResponse.text() || `Server error (${parseResponse.status})`);
      }

      const parseResult = await parseResponse.json();
      const uriMap = parseResult.uriMap || {};
      const allUrls: string[] = parseResult.urls || [];
      const parsedMovieIndex = parseResult.movieIndex || {}; // Contains csv_name/csv_year
      const totalFilms = allUrls.length;

      setScrapeStatus(`Found ${totalFilms} films. Enriching with TMDb data...`);
      setScrapeProgress({ current: 0, total: totalFilms });

      // Phase 2: Enrich in batches
      let mergedMovieIndex: Record<string, any> = {};
      const batchSize = 10;
      let processed = 0;

      for (let i = 0; i < allUrls.length; i += batchSize) {
        const batch = allUrls.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;

        // Build films data with name/year for this batch
        const filmsData: Record<string, { name?: string; year?: string }> = {};
        for (const url of batch) {
          const movieData = parsedMovieIndex[url];
          if (movieData) {
            filmsData[url] = {
              name: movieData.csv_name,
              year: movieData.csv_year,
            };
          }
        }

        const enrichResponse = await fetch(`${baseUrl}/api/movies?enrich=1`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls: batch, films: filmsData }),
        });

        if (!enrichResponse.ok) {
          throw new Error(await enrichResponse.text() || `Server error (${enrichResponse.status})`);
        }

        const enrichResult = await enrichResponse.json();
        const batchStats = enrichResult.stats || {};

        if (enrichResult.movieIndex) {
          const batchMovies = Object.keys(enrichResult.movieIndex).length;
          const moviesWithTmdb = Object.values(enrichResult.movieIndex).filter((m: any) => m.tmdb_data).length;
          const moviesWithErrors = Object.values(enrichResult.movieIndex).filter((m: any) => m.tmdb_error || m.tmdb_api_error).length;
          logDebug(
            `Batch ${batchNum}/${Math.ceil(allUrls.length / batchSize)}: ${batchMovies} movies, ${moviesWithTmdb} with TMDb, ${moviesWithErrors} errors, cache: ${batchStats.cacheHits || 0} hits`
          );
          mergedMovieIndex = { ...mergedMovieIndex, ...enrichResult.movieIndex };
        } else {
          console.warn(`Batch ${batchNum}: No movieIndex in response! Keys:`, Object.keys(enrichResult || {}));
        }

        processed += batch.length;
        setScrapeStatus(`Enriching movies... ${processed}/${totalFilms} (batch ${batchNum})`);
        setScrapeProgress({ current: processed, total: totalFilms });
      }

      json = { movieIndex: mergedMovieIndex, uriMap };

      // Log final stats
      const totalMerged = Object.keys(mergedMovieIndex).length;
      const totalWithTmdb = Object.values(mergedMovieIndex).filter((m: any) => m.tmdb_data).length;
      const totalWithErrors = Object.values(mergedMovieIndex).filter((m: any) => m.tmdb_error || m.tmdb_api_error).length;
      logDebug(
        `=== ENRICHMENT COMPLETE: ${totalWithTmdb}/${totalMerged} movies with TMDb data, ${totalWithErrors} errors ===`
      );
    }
    logDebug("Raw result summary:", {
      isObject: typeof json === "object" && json !== null,
      keys: json ? Object.keys(json) : [],
      movieIndexSize: json?.movieIndex ? Object.keys(json.movieIndex).length : 0,
      uriMapSize: json?.uriMap ? Object.keys(json.uriMap).length : 0,
    });
    
    if (!json || typeof json !== "object") {
      console.error("Invalid JSON result, type:", typeof json);
      throw new Error("Invalid result format from server");
    }
    
    const extractedIndex: Record<string, any> = (json && typeof json === "object" && (json as any).movieIndex)
      ? ((json as any).movieIndex as Record<string, any>)
      : (json as Record<string, any>);

    const extractedUriMap: Record<string, string> | null = (json && typeof json === "object" && (json as any).uriMap)
      ? ((json as any).uriMap as Record<string, string>)
      : null;

    setMovieIndex(extractedIndex);
    setUriMap(extractedUriMap);
    setScrapeProgress(null);
    setScrapeStatus(`Movie index ready: ${Object.keys(extractedIndex).length} films`);
    setIsLoading(false);

    // Log the data structure for sanity checking
    logDebug("Movie index loaded:", Object.keys(extractedIndex).length, "films");
    logDebug("Sample entry:", Object.entries(extractedIndex)[0]);
    const firstEntry = Object.entries(extractedIndex)[0];
    logDebug("Sample entry keys:", firstEntry ? Object.keys(firstEntry[1] as any) : "none");
  }

  const processDiaryFile = (file: File) => {
    setRatingFilter(null);
    setDecadeFilter(null);
    setGeoFilter(null);
    setDateFilter("all");
    setIsDiaryFormat(true);
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Please upload a CSV file.");
      setRows([]);
      return;
    }

    setError(null);
    setIsLoading(true);
    setRows([]);

    buildMovieIndex(file).catch((e) => {
      setError(e.message);
      setScrapeStatus(null);
      setScrapeProgress(null);
      setIsLoading(false);
    });

    Papa.parse<DiaryRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        // Filter out completely empty rows, just in case
        const data = result.data.filter(
          (row: DiaryRow) => Object.keys(row).length > 1
        );
        // Optional: peek at the first row in DevTools
        logDebug("Sample diary row:", data[0]);
        const hasDiaryFormat = data.length > 0 && Object.prototype.hasOwnProperty.call(data[0], "Watched Date");
        setIsDiaryFormat(hasDiaryFormat);
        setRows(data);
        // Note: isLoading will be set to false when buildMovieIndex completes
      },
      error: (err) => {
        setError(err.message);
        setRows([]);
        setIsLoading(false);
      },
    });
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setDiaryFileName(file ? file.name : "No file selected");
    if (!file) return;
    processDiaryFile(file);
  };

  // Watchlist file handler
  const processWatchlistFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Please upload a CSV file.");
      return;
    }

    setError(null);
    setIsWatchlistLoading(true);
    setWatchlistStatus("Processing watchlist...");
    setWatchlistMovies([]);
    setWatchlistMissingCount(0);
    setWatchlistMissingSamples([]);
    setWatchlistMissingDebug([]);
    setWatchlistUriMapSize(0);

    try {
      // Detect environment
      const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const useRemoteApi = isLocalHost && watchlistUseVercelApi;
      const baseUrl = useRemoteApi ? 'https://letterbddy.vercel.app' : isLocalHost ? 'http://localhost:5050' : '';

      let json: any;

      if (isLocalHost && !useRemoteApi) {
        // Local development: use Express server with job polling
        const form = new FormData();
        form.append("file", file);

        const apiUrl = `${baseUrl}/api/movies?enrich=1`;
        const startRes = await fetch(apiUrl, { method: "POST", body: form });

        if (!startRes.ok) {
          throw new Error(await startRes.text() || `Server error (${startRes.status})`);
        }

        const { jobId } = await startRes.json();

        // Poll for status
        while (true) {
          const statusRes = await fetch(`${baseUrl}/api/movies/${jobId}/status`);
          if (!statusRes.ok) throw new Error(await statusRes.text());

          const status = await statusRes.json();

          if (status.state === "error") throw new Error(status.error || "Processing failed");

          if (typeof status.current === "number" && typeof status.total === "number" && status.total > 0) {
            setWatchlistProgress({ current: status.current, total: status.total });
            setWatchlistStatus(`${status.message} ${status.current}/${status.total}`);
          } else {
            setWatchlistStatus(status.message || "Working…");
          }

          if (status.state === "done") break;
          await new Promise((r) => setTimeout(r, 750));
        }

        // Get results
        const resultRes = await fetch(`${baseUrl}/api/movies/${jobId}/result`);
        if (!resultRes.ok) throw new Error(await resultRes.text());

        json = await resultRes.json();
      } else {
        // Production (Vercel): two-phase approach
        // Phase 1: Parse CSV and resolve shortlinks
        setWatchlistStatus("Parsing watchlist...");

        const csvContent = await file.text();
        const parseResponse = await fetch(`${baseUrl}/api/movies?parse_only=1`, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: csvContent,
        });

        if (!parseResponse.ok) {
          throw new Error(await parseResponse.text() || `Server error (${parseResponse.status})`);
        }

        const parseResult = await parseResponse.json();
        const uriMap = parseResult.uriMap || {};
        const allUrls: string[] = parseResult.urls || [];
        const parsedMovieIndex = parseResult.movieIndex || {}; // Contains csv_name/csv_year
        const totalFilms = allUrls.length;

        setWatchlistStatus(`Found ${totalFilms} films. Enriching...`);
        setWatchlistProgress({ current: 0, total: totalFilms });

        // Phase 2: Enrich in batches
        let mergedMovieIndex: Record<string, any> = {};
        const batchSize = 10;
        let processed = 0;

        for (let i = 0; i < allUrls.length; i += batchSize) {
          const batch = allUrls.slice(i, i + batchSize);
          const batchNum = Math.floor(i / batchSize) + 1;

          // Build films data with name/year for this batch
          const filmsData: Record<string, { name?: string; year?: string }> = {};
          for (const url of batch) {
            const movieData = parsedMovieIndex[url];
            if (movieData) {
              filmsData[url] = {
                name: movieData.csv_name,
                year: movieData.csv_year,
              };
            }
          }

          const enrichResponse = await fetch(`${baseUrl}/api/movies?enrich=1`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ urls: batch, films: filmsData }),
          });

          if (!enrichResponse.ok) {
            throw new Error(await enrichResponse.text() || `Server error (${enrichResponse.status})`);
          }

          const enrichResult = await enrichResponse.json();
          if (enrichResult.movieIndex) {
            mergedMovieIndex = { ...mergedMovieIndex, ...enrichResult.movieIndex };
          }

          processed += batch.length;
          setWatchlistStatus(`Enriching watchlist... ${processed}/${totalFilms} (batch ${batchNum})`);
          setWatchlistProgress({ current: processed, total: totalFilms });
        }

        json = { movieIndex: mergedMovieIndex, uriMap };
        setWatchlistProgress(null);
      }

      const index = json?.movieIndex || json || {};
      const uriMap = json?.uriMap || {};
      setWatchlistUriMapSize(Object.keys(uriMap || {}).length);

      const resolveFromUriMap = (uri: string) => {
        const trimmed = (uri || "").trim();
        if (!trimmed) return null;
        const noSlash = trimmed.replace(/\/+$/, "");
        const withSlash = `${noSlash}/`;
        const httpsNoSlash = noSlash.replace(/^http:\/\//i, "https://");
        const httpsWithSlash = `${httpsNoSlash}/`;
        return (
          uriMap[trimmed] ||
          uriMap[noSlash] ||
          uriMap[withSlash] ||
          uriMap[httpsNoSlash] ||
          uriMap[httpsWithSlash] ||
          null
        );
      };

      const canonicalizeUriWithMap = (uri: string) => {
        let next = (uri || "").trim();
        if (!next) return next;
        next = next.replace(/\/+$/, "");
        if (/^https?:\/\/boxd\.it\//i.test(next)) {
          const mapped = resolveFromUriMap(next);
          if (typeof mapped === "string" && mapped.trim()) {
            next = mapped.trim();
          }
          return next;
        }
        const match = next.match(/https?:\/\/letterboxd\.com\/(?:[^/]+\/)?film\/([^/]+)/i);
        if (match) {
          return `https://letterboxd.com/film/${match[1]}/`;
        }
        return next;
      };

      // Build a lookup keyed by many URI forms so we can match boxd.it and other aliases
      const lookup: Record<string, any> = {};
      for (const [key, movie] of Object.entries(index as Record<string, any>)) {
        lookup[key] = movie;
        const aliases: string[] = [];
        if (typeof movie?.letterboxd_url === "string") aliases.push(movie.letterboxd_url);
        if (Array.isArray(movie?.letterboxd_urls)) aliases.push(...movie.letterboxd_urls);
        if (Array.isArray(movie?.source_uris)) aliases.push(...movie.source_uris);
        if (Array.isArray(movie?.aliases)) aliases.push(...movie.aliases);
        if (typeof movie?.original_uri === "string") aliases.push(movie.original_uri);
        if (typeof movie?.shortlink === "string") aliases.push(movie.shortlink);
        if (typeof movie?.boxd_shortlink === "string") aliases.push(movie.boxd_shortlink);

        for (const a of aliases) {
          if (typeof a !== "string") continue;
          const trimmed = a.trim();
          if (!trimmed) continue;
          lookup[trimmed] = movie;
        }

        if (typeof key === "string") {
          const m = key.match(/https?:\/\/letterboxd\.com\/(?:[^/]+\/)?film\/([^/]+)\/?/i);
          if (m) {
            const canonical = `https://letterboxd.com/film/${m[1]}/`;
            lookup[canonical] = movie;
          }
        }
      }

      // Parse the original CSV to get movie names/years
      const csvText = await file.text();
      const parsed = Papa.parse<WatchlistRow>(csvText, { header: true, skipEmptyLines: true });

      // Build enriched watchlist
      const enrichedMovies: WatchlistMovie[] = [];
      const missingSamples: WatchlistRow[] = [];
      const missingDebug: Array<{
        name: string;
        year: string;
        originalUri: string;
        resolvedUri: string;
        canonicalUri: string;
        foundInLookup: boolean;
        hadUriMap: boolean;
        tmdbId?: number | null;
        tmdbError?: string | null;
      }> = [];
      let missingCount = 0;

      for (const row of parsed.data) {
        const originalUri = row["Letterboxd URI"];
        if (!originalUri) continue;

        // Resolve shortlink to canonical URL using uriMap, then look up in index
        const resolvedUri = resolveFromUriMap(originalUri) || originalUri;
        const canonical = canonicalizeUriWithMap(resolvedUri);
        const canonicalOriginal = canonicalizeUriWithMap(originalUri);
        const movie =
          lookup[canonical] ||
          lookup[resolvedUri] ||
          lookup[canonicalOriginal] ||
          index[canonical] ||
          index[resolvedUri] ||
          index[canonicalOriginal];
        const tmdbData = movie?.tmdb_data;

        const directedByWoman = tmdbData?.directed_by_woman === true;
        const writtenByWoman = tmdbData?.written_by_woman === true;
        const notAmerican = tmdbData?.is_american === false;
        const notEnglish = tmdbData?.is_english === false;
        const inCriterion = movie?.is_in_criterion_collection === true;
        const runtime = typeof tmdbData?.runtime === "number" ? tmdbData.runtime : null;
        const countryCodes = Array.isArray(tmdbData?.production_countries?.codes)
          ? tmdbData.production_countries.codes.filter(Boolean)
          : [];
        const continentsForMovie = Array.from(
          new Set(countryCodes.map(getContinentCode).filter(Boolean) as string[])
        );

        // Extract director names
        const directors = tmdbData?.directors || [];
        const directorNames = directors.map((d: any) => d.name).filter(Boolean).join(", ");

        const criteriaCount = [directedByWoman, writtenByWoman, notAmerican, notEnglish, inCriterion]
          .filter(Boolean).length;

        if (!tmdbData) {
          missingCount += 1;
          if (missingSamples.length < 25) {
            missingSamples.push(row);
          }
          if (missingDebug.length < 25) {
            missingDebug.push({
              name: row.Name || "",
              year: row.Year || "",
              originalUri,
              resolvedUri,
              canonicalUri: canonical,
              foundInLookup: !!movie,
              hadUriMap: Boolean(resolveFromUriMap(originalUri)),
              tmdbId: movie?.tmdb_movie_id ?? null,
              tmdbError: (movie?.tmdb_error || movie?.tmdb_api_error || null),
            });
          }
          continue;
        }

        // Include all movies with TMDb data (runtime filter can apply to any movie)
        if (tmdbData) {
          enrichedMovies.push({
            name: row.Name,
            year: row.Year,
            uri: resolvedUri,
            director: directorNames || "Unknown",
            runtime,
            continents: continentsForMovie,
            directedByWoman,
            writtenByWoman,
            notAmerican,
            notEnglish,
            inCriterion,
            criteriaCount,
          });
        }
      }

      setWatchlistMissingCount(missingCount);
      setWatchlistMissingSamples(missingSamples);
      setWatchlistMissingDebug(missingDebug);

      // Sort by criteria count (descending), randomize within same tier
      enrichedMovies.sort((a, b) => {
        if (b.criteriaCount !== a.criteriaCount) {
          return b.criteriaCount - a.criteriaCount;
        }
        // Same criteria count - randomize
        return Math.random() - 0.5;
      });

      setWatchlistMovies(enrichedMovies);
      setWatchlistStatus(`Found ${enrichedMovies.length} movies matching criteria`);
    } catch (err: any) {
      setError(err.message);
      setWatchlistStatus(null);
    } finally {
      setIsWatchlistLoading(false);
      setWatchlistProgress(null);
    }
  };

  const handleWatchlistChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setWatchlistFileName(file ? file.name : "No file selected");
    if (!file) return;
    await processWatchlistFile(file);
  };

  const loadSampleCsv = async (path: string, fileName: string) => {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Failed to load sample: ${fileName}`);
    const blob = await res.blob();
    return new File([blob], fileName, { type: "text/csv" });
  };

  const isLocalDev =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

  const movieLookup = useMemo(() => {
    if (!movieIndex) return null;

    const lookup: Record<string, any> = {};
    for (const [key, movie] of Object.entries(movieIndex)) {
      // Canonical key
      lookup[key] = movie;

      // Common alias fields (be liberal; harmless if missing)
      const aliases: string[] = [];
      if (typeof movie?.letterboxd_url === "string") aliases.push(movie.letterboxd_url);
      if (Array.isArray(movie?.letterboxd_urls)) aliases.push(...movie.letterboxd_urls);
      if (Array.isArray(movie?.source_uris)) aliases.push(...movie.source_uris);
      if (Array.isArray(movie?.aliases)) aliases.push(...movie.aliases);
      if (typeof movie?.original_uri === "string") aliases.push(movie.original_uri);
      if (typeof movie?.shortlink === "string") aliases.push(movie.shortlink);
      if (typeof movie?.boxd_shortlink === "string") aliases.push(movie.boxd_shortlink);

      for (const a of aliases) {
        if (typeof a !== "string") continue;
        const trimmed = a.trim();
        if (!trimmed) continue;
        lookup[trimmed] = movie;
      }

      // Also support user-scoped film URLs by canonicalizing them to /film/<slug>/
      if (typeof key === "string") {
        const m = key.match(/https?:\/\/letterboxd\.com\/(?:[^/]+\/)?film\/([^/]+)\/?/i);
        if (m) {
          const canonical = `https://letterboxd.com/film/${m[1]}/`;
          lookup[canonical] = movie;
        }
      }
    }

    return lookup;
  }, [movieIndex]);

  // Extract unique years from diary entries, sorted descending (newest first)
  const getWatchedDate = (row: DiaryRow) =>
    (row["Watched Date"] || (row as any).Date || "").trim();

  const availableYears = useMemo(
    () => {
      if (!isDiaryFormat) return [];
      return Array.from(
        new Set(
          rows
            .map((row) => getWatchedDate(row).slice(0, 4))
            .filter((year) => year && /^\d{4}$/.test(year))
        )
      ).sort((a, b) => parseInt(b) - parseInt(a));
    },
    [rows, isDiaryFormat]
  );

  const heatmapYears = useMemo(
    () => [...availableYears].sort((a, b) => parseInt(a) - parseInt(b)),
    [availableYears]
  );

  useEffect(() => {
    if (dateFilter !== "all") return;
    const container = heatmapScrollRef.current;
    if (!container) return;
    let frame = 0;
    const scrollToEnd = () => {
      container.scrollLeft = Math.max(0, container.scrollWidth - container.clientWidth);
    };
    frame = window.requestAnimationFrame(scrollToEnd);
    const timeout = window.setTimeout(scrollToEnd, 50);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [dateFilter, heatmapYears]);

  const diaryDateCounts = useMemo(() => {
    const byYear = new Map<string, Map<string, number>>();
    for (const row of rows) {
      const raw = getWatchedDate(row);
      if (!raw) continue;
      const dateKey = raw.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
      const date = new Date(dateKey);
      if (Number.isNaN(date.getTime())) continue;
      const year = dateKey.slice(0, 4);
      if (!byYear.has(year)) byYear.set(year, new Map());
      const yearMap = byYear.get(year)!;
      yearMap.set(dateKey, (yearMap.get(dateKey) || 0) + 1);
    }
    return byYear;
  }, [rows]);

  // Filter rows based on selected time range
  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        if (dateFilter === "all") return true;

        // diary "Watched Date" or watched list "Date" is "YYYY-MM-DD"
        const watched = getWatchedDate(row);
        if (!watched) return false;

        const year = watched.slice(0, 4); // "2025-04-12" -> "2025"
        return year === dateFilter;
      }),
    [rows, dateFilter]
  );

  // Build a map of unique films (dedupe rewatches)
  const films = useMemo(() => {
    const filmMap = new Map<string, FilmSummary>();

    for (const row of filteredRows) {
      const name = (row.Name ?? "").trim();
      const year = (row.Year ?? "").trim();

      if (!name) continue; // skip malformed rows

      const key = `${name} (${year || "????"})`;
      const isRewatch = (row.Rewatch || "").toLowerCase() === "yes";

      const existing = filmMap.get(key);
      if (!existing) {
        filmMap.set(key, {
          key,
          name,
          year,
          entryCount: 1,
          hasRewatch: isRewatch,
        });
      } else {
        existing.entryCount += 1;
        existing.hasRewatch = existing.hasRewatch || isRewatch;
      }
    }

    return Array.from(filmMap.values());
  }, [filteredRows]);

  // Basic stats
  const totalEntries = filteredRows.length; // diary rows incl. rewatches
  const uniqueFilmCount = films.length; // each film counted once
  const rewatchedFilmCount = films.filter(
    (film) => film.hasRewatch || film.entryCount > 1
  ).length; // films you rewatched at least once

  // TMDb stats (from movieIndex, filtered to match current date range)
  // Get unique Letterboxd URIs from filtered diary rows
  const filteredUris = useMemo(
    () =>
      new Set(
        filteredRows
          .map((row) => (row["Letterboxd URI"] || "").trim())
          .filter((uri) => uri)
      ),
    [filteredRows]
  );

  const ratingFilteredUris = useMemo(
    () =>
      new Set(
        (ratingFilter
          ? filteredRows.filter((row) => {
              const value = parseFloat(row.Rating);
              return !Number.isNaN(value) && value.toFixed(1) === ratingFilter;
            })
          : filteredRows
        )
          .map((row) => (row["Letterboxd URI"] || "").trim())
          .filter((uri) => uri)
      ),
    [filteredRows, ratingFilter]
  );
  
  // Normalize URIs for matching - convert user-scoped URLs to canonical /film/<slug>/ format,
  // and canonicalize boxd.it shortlinks using uriMap if available
  const canonicalizeUri = useCallback((uri: string): string => {
    uri = (uri || "").trim();
    if (!uri) return uri;

    // Normalize trailing slash handling
    uri = uri.replace(/\/+$/, "");

    // If it's a boxd.it shortlink, prefer the server-provided mapping
    if (/^https?:\/\/boxd\.it\//i.test(uri)) {
      const mapped = uriMap ? uriMap[uri] : null;
      if (typeof mapped === "string" && mapped.trim()) {
        return mapped.trim();
      }
      return uri;
    }

    // Canonicalize Letterboxd film URLs (including user-scoped)
    const match = uri.match(/https?:\/\/letterboxd\.com\/(?:[^/]+\/)?film\/([^/]+)/i);
    if (match) {
      return `https://letterboxd.com/film/${match[1]}/`;
    }

    return uri;
  }, [uriMap]);
  
  // Create sets of both original and canonicalized URIs for matching
  const canonicalizedFilteredUris = useMemo(
    () => new Set(Array.from(filteredUris).map(canonicalizeUri)),
    [filteredUris, canonicalizeUri]
  );
  
  const getProductionCountryCodes = useCallback((movie: any): string[] => {
    const codes = movie?.tmdb_data?.production_countries?.codes;
    return Array.isArray(codes) ? codes.filter(Boolean) : [];
  }, []);

  const matchesDecadeFilter = useCallback((movie: any) => {
    if (!decadeFilter) return true;
    const releaseDate = movie?.tmdb_data?.release_date;
    if (typeof releaseDate !== "string" || releaseDate.length < 4) return false;
    const year = parseInt(releaseDate.slice(0, 4), 10);
    if (Number.isNaN(year)) return false;

    if (decadeFilter.type === "decade") {
      const label = `${Math.floor(year / 10) * 10}s`;
      return label === decadeFilter.label;
    }

    const decadeStart = Math.floor((year - 6) / 10) * 10 + 6;
    const decadeEnd = decadeStart + 9;
    const label = `${decadeStart}-${decadeEnd}`;
    return label === decadeFilter.label;
  }, [decadeFilter]);

  const matchesGeoFilter = useCallback((movie: any) => {
    if (!geoFilter) return true;
    const codes = getProductionCountryCodes(movie);
    if (geoFilter.type === "country") {
      return codes.map((c) => c.toUpperCase()).includes(geoFilter.value.toUpperCase());
    }
    const continentsForFilm = new Set(
      codes.map(getContinentCode).filter(Boolean) as string[]
    );
    return continentsForFilm.has(geoFilter.value);
  }, [geoFilter, getProductionCountryCodes]);

  // Match movieIndex entries to filtered diary entries using the alias lookup
  const matchedMovies = useMemo(() => {
    if (!movieLookup) return [];
    const matched = new Map<string, any>();
    for (const raw of ratingFilteredUris) {
      const canon = canonicalizeUri(raw);
      const movie = movieLookup[canon] || movieLookup[raw];
      if (movie) {
        const idKey = (movie.letterboxd_url as string) || canon || raw;
        matched.set(idKey, movie);
      }
    }
    return Array.from(matched.values());
  }, [movieLookup, ratingFilteredUris, canonicalizeUri]);

  const moviesWithDataBase = useMemo(
    () =>
      matchedMovies.filter((movie: any) => {
        if (!movie.tmdb_data) return false;
        return matchesDecadeFilter(movie);
      }),
    [matchedMovies, matchesDecadeFilter]
  );

  const moviesWithData = useMemo(
    () => moviesWithDataBase.filter(matchesGeoFilter),
    [moviesWithDataBase, matchesGeoFilter]
  );
  const totalMoviesWithData = moviesWithData.length;

  const { countryCounts, continentCounts } = useMemo(() => {
    const counts: Record<string, number> = {};
    const contCounts: Record<string, number> = {};
    for (const movie of moviesWithDataBase) {
      const codes = getProductionCountryCodes(movie).map((c) => c.toUpperCase());
      for (const code of codes) {
        counts[code] = (counts[code] || 0) + 1;
      }
      const continentsForFilm = new Set(
        codes.map(getContinentCode).filter(Boolean) as string[]
      );
      for (const cont of continentsForFilm) {
        contCounts[cont] = (contCounts[cont] || 0) + 1;
      }
    }
    return { countryCounts: counts, continentCounts: contCounts };
  }, [moviesWithDataBase, getProductionCountryCodes]);

  const maxCountryCount = useMemo(
    () => Math.max(1, ...Object.values(countryCounts)),
    [countryCounts]
  );
  const maxContinentCount = useMemo(
    () => Math.max(1, ...Object.values(continentCounts)),
    [continentCounts]
  );

  const continentColors: Record<string, string> = {
    AF: "#f97316",
    AS: "#f59e0b",
    EU: "#3b82f6",
    NA: "#22c55e",
    SA: "#14b8a6",
    OC: "#a855f7",
    AN: "#94a3b8",
  };

  const mixHex = (a: string, b: string, t: number) => {
    const toRgb = (hex: string) => {
      const h = hex.replace("#", "");
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
      };
    };
    const ar = toRgb(a);
    const br = toRgb(b);
    const mix = (x: number, y: number) => Math.round(x + (y - x) * t);
    return `#${mix(ar.r, br.r).toString(16).padStart(2, "0")}${mix(ar.g, br.g).toString(16).padStart(2, "0")}${mix(ar.b, br.b).toString(16).padStart(2, "0")}`;
  };

  const tmdbErrorCounts = useMemo(
    () =>
      matchedMovies.reduce<Record<string, number>>((acc, movie: any) => {
        const err = movie.tmdb_error || movie.tmdb_api_error;
        if (!err) return acc;
        const key = String(err).slice(0, 80);
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
    [matchedMovies]
  );
  const topTmdbErrors = useMemo(
    () => Object.entries(tmdbErrorCounts).sort((a, b) => b[1] - a[1]).slice(0, 2),
    [tmdbErrorCounts]
  );
  
  const { directedByWoman, writtenByWoman, notAmerican, notEnglish, inCriterion } = useMemo(
    () => ({
      directedByWoman: moviesWithData.filter((m: any) => m.tmdb_data?.directed_by_woman === true).length,
      writtenByWoman: moviesWithData.filter((m: any) => m.tmdb_data?.written_by_woman === true).length,
      notAmerican: moviesWithData.filter((m: any) => m.tmdb_data?.is_american === false).length,
      notEnglish: moviesWithData.filter((m: any) => m.tmdb_data?.is_english === false).length,
      inCriterion: moviesWithData.filter((m: any) => m.is_in_criterion_collection === true).length,
    }),
    [moviesWithData]
  );
  
  // Debug logging - only create the object if debugging is actually enabled
  if (shouldLogDebug()) {
    logDebug("=== TMDb Stats Debug ===", {
      movieIndexSize: movieIndex ? Object.keys(movieIndex).length : 0,
      movieLookupSize: movieLookup ? Object.keys(movieLookup).length : 0,
      filteredUrisCount: filteredUris.size,
      moviesWithDataCount: totalMoviesWithData,
      stats: { directedByWoman, writtenByWoman, notAmerican, notEnglish, inCriterion },
    });
  }

  // Rewatch vs first-watch stats (entry-based, not deduped by film)
  const rewatchEntryCount = useMemo(
    () =>
      filteredRows.filter((row) => (row.Rewatch || "").toLowerCase() === "yes").length,
    [filteredRows]
  );
  const firstWatchEntryCount = totalEntries - rewatchEntryCount;


  // Rating stats for the current range (only rows with a numeric Rating)
  const numericRatings = useMemo(
    () =>
      filteredRows
        .map((row) => parseFloat(row.Rating))
        .filter((r) => !Number.isNaN(r)),
    [filteredRows]
  );

  const {
    ratingCount,
    averageRating,
    medianRating,
    fourPlusCount,
    ratingChartData,
  } = useMemo(() => {
    const ratingCount = numericRatings.length;
    const ratingSum = numericRatings.reduce((sum, r) => sum + r, 0);
    const averageRating = ratingCount === 0 ? 0 : ratingSum / ratingCount;

    const sortedRatings = [...numericRatings].sort((a, b) => a - b);
    let medianRating = 0;
    if (ratingCount > 0) {
      const mid = Math.floor(ratingCount / 2);
      if (ratingCount % 2 === 1) {
        medianRating = sortedRatings[mid];
      } else {
        medianRating = (sortedRatings[mid - 1] + sortedRatings[mid]) / 2;
      }
    }

    const fourPlusCount = numericRatings.filter((r) => r >= 4).length;

    const ratingBuckets: Record<string, number> = {
      "0.5": 0,
      "1.0": 0,
      "1.5": 0,
      "2.0": 0,
      "2.5": 0,
      "3.0": 0,
      "3.5": 0,
      "4.0": 0,
      "4.5": 0,
      "5.0": 0,
    };

    numericRatings.forEach((r) => {
      const key = r.toFixed(1); // e.g. 3.5 -> "3.5"
      if (ratingBuckets[key] !== undefined) {
        ratingBuckets[key] += 1;
      }
    });

    const ratingChartData = Object.entries(ratingBuckets).map(([rating, count]) => ({
      rating,
      count,
    }));

    return {
      ratingCount,
      averageRating,
      medianRating,
      fourPlusCount,
      ratingChartData,
    };
  }, [numericRatings]);

  const toggleRatingFilter = (rating: string) => {
    setRatingFilter((prev) => (prev === rating ? null : rating));
  };

  const toggleDecadeFilter = (type: "decade" | "offset", label: string) => {
    setDecadeFilter((prev) => (prev && prev.type === type && prev.label === label ? null : { type, label }));
  };

  return (
    <main style={{ minHeight: "100vh", backgroundColor: "#14181c", color: "#ccd", display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 16px" }}>
      <Analytics />
      <SpeedInsights />
      <div style={{ width: "100%", maxWidth: "980px", display: "flex", flexDirection: "column", gap: "32px" }}>
        <header style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: "28px", fontWeight: 700, color: "#fff", marginBottom: "6px", letterSpacing: "0.5px" }}>
            Letterbddy
          </h1>
          <div style={{ fontSize: "12px", color: "#9ab", marginBottom: "10px" }}>by Kat Swint</div>
          <p style={{ fontSize: "14px", color: "#9ab" }}>
            Upload your diary.csv to get started
          </p>
        </header>

        {/* Input section */}
        <section style={{ backgroundColor: "rgba(68, 85, 102, 0.2)", borderRadius: "8px", padding: "24px" }}>
          <div>
            <label style={{ fontSize: "14px", color: "#def", display: "block", marginBottom: "8px" }}>
              Upload Diary CSV
            </label>
            <p style={{ fontSize: "12px", color: "#678", marginBottom: "12px" }}>
              Export from Letterboxd: Settings → Import & Export → Export Your Data
            </p>
            <input
              id="diary-file-input"
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              style={{ display: "none" }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "13px", color: "#9ab" }}>Choose file:</span>
              <label
                htmlFor="diary-file-input"
                style={{
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid #4b5a66",
                  backgroundColor: "#1b2026",
                  color: "#e2e8f0",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.05)",
                }}
              >
                {diaryFileName}
              </label>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const file = await loadSampleCsv("/kat_diary.csv", "kat_diary.csv");
                    setDiaryFileName(file.name);
                    processDiaryFile(file);
                  } catch (e: any) {
                    setError(e.message || "Failed to load sample diary");
                  }
                }}
                style={{
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: "1px solid #456",
                  backgroundColor: "transparent",
                  color: "#9ab",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Try with Kat's
              </button>
            </div>
          </div>

          {/* Loading state with spinner - only show when actively loading */}
          {isLoading && (
            <div style={{ marginTop: "16px" }}>
              <LoadingSpinner message={scrapeStatus || "Loading..."} />
              <div style={{ marginTop: "8px" }}>
                <div style={{
                  height: "6px",
                  width: "100%",
                  backgroundColor: "rgba(68, 85, 102, 0.3)",
                  borderRadius: "3px",
                  overflow: "hidden"
                }}>
                  {scrapeProgress && scrapeProgress.total > 0 ? (
                    <div
                      style={{
                        height: "100%",
                        borderRadius: "3px",
                        backgroundColor: "#00e054",
                        width: `${Math.min(100, Math.round((scrapeProgress.current / scrapeProgress.total) * 100))}%`,
                        transition: "width 0.3s ease",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        height: "100%",
                        borderRadius: "3px",
                        backgroundColor: "#00e054",
                        width: "30%",
                        animation: "indeterminate 1.5s ease-in-out infinite",
                      }}
                    />
                  )}
                </div>
                {scrapeProgress && scrapeProgress.total > 0 ? (
                  <p style={{ fontSize: "12px", color: "#678", marginTop: "8px", textAlign: "center" }}>
                    {scrapeProgress.current} / {scrapeProgress.total} ({Math.round((scrapeProgress.current / scrapeProgress.total) * 100)}%)
                  </p>
                ) : (
                  <p style={{ fontSize: "12px", color: "#678", marginTop: "8px", textAlign: "center" }}>
                    Connecting to server...
                  </p>
                )}
              </div>
            </div>
          )}

          {!isLoading && isLocalDev && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: "8px" }}>
              <label style={{ fontSize: "12px", color: "#9ab", display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="checkbox"
                  checked={diaryUseVercelApi}
                  onChange={(e) => setDiaryUseVercelApi(e.target.checked)}
                />
                Use Vercel API for diary (uses prod cache)
              </label>
            </div>
          )}

          {/* Error state */}
          {error && (
            <p style={{ color: "#f87171", fontSize: "14px", marginTop: "12px" }}>
              {error}
            </p>
          )}

          {/* Success state */}
          {!isLoading && rows.length > 0 && !error && (
            <div style={{ marginTop: "16px", padding: "12px", backgroundColor: "rgba(0, 224, 84, 0.1)", borderRadius: "6px", textAlign: "center" }}>
              <p style={{ color: "#00e054", fontSize: "14px", fontWeight: 500 }}>
                ✓ Loaded {rows.length} diary entries
              </p>
              {movieIndex && (
                <p style={{ color: "#9ab", fontSize: "12px", marginTop: "4px" }}>
                  {Object.keys(movieIndex).length} unique films indexed
                </p>
              )}
            </div>
          )}

          {/* Reviews upload (optional) */}
          {rows.length > 0 && (
            <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: "1px solid #345" }}>
              <label style={{ fontSize: "14px", color: "#def", display: "block", marginBottom: "8px" }}>
                Upload Reviews CSV (optional)
              </label>
              <p style={{ fontSize: "12px", color: "#678", marginBottom: "12px" }}>
                For review word count analysis
              </p>
              <input
                id="reviews-file-input"
                type="file"
                accept=".csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  setReviewsFileName(file ? file.name : "No file selected");
                  if (!file) return;
                  Papa.parse<ReviewRow>(file, {
                    header: true,
                    skipEmptyLines: true,
                    complete: (result) => {
                      const data = result.data.filter(
                        (row: ReviewRow) => row.Review && row.Review.trim().length > 0
                      );
                      setReviews(data);
                    },
                  });
                }}
                style={{ display: "none" }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "13px", color: "#9ab" }}>Choose file:</span>
                <label
                  htmlFor="reviews-file-input"
                  style={{
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid #4b5a66",
                    backgroundColor: "#1b2026",
                    color: "#e2e8f0",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.05)",
                  }}
                >
                  {reviewsFileName}
                </label>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const file = await loadSampleCsv("/kat_reviews.csv", "kat_reviews.csv");
                      setReviewsFileName(file.name);
                      Papa.parse<ReviewRow>(file, {
                        header: true,
                        skipEmptyLines: true,
                        complete: (result) => {
                          const data = result.data.filter(
                            (row: ReviewRow) => row.Review && row.Review.trim().length > 0
                          );
                          setReviews(data);
                        },
                      });
                    } catch (e: any) {
                      setError(e.message || "Failed to load sample reviews");
                    }
                  }}
                  style={{
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid #456",
                    backgroundColor: "transparent",
                    color: "#9ab",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Try with Kat's
                </button>
              </div>
              {reviews.length > 0 && (
                <p style={{ color: "#00e054", fontSize: "12px", marginTop: "8px" }}>
                  ✓ Loaded {reviews.length} reviews
                </p>
              )}
            </div>
          )}

        </section>

        {/* Time range selector */}
        {rows.length > 0 && !isDiaryFormat && (
          <section
            style={{
              backgroundColor: "rgba(0, 224, 84, 0.1)",
              border: "1px solid rgba(0, 224, 84, 0.3)",
              borderRadius: "8px",
              padding: "12px 16px",
              marginBottom: "16px",
              maxWidth: "600px",
              margin: "0 auto 16px",
              textAlign: "center",
            }}
          >
            <p style={{ fontSize: "14px", color: "#9ab", margin: 0 }}>
              <strong style={{ color: "#00e054" }}>watched.csv detected</strong>
              {" — "}
              Year filter and activity calendar are unavailable because this file doesn't include watch dates.
              For these features, upload your <strong>diary.csv</strong> instead.
            </p>
          </section>
        )}

        {rows.length > 0 && availableYears.length > 0 && (
          <section style={{ display: "flex", justifyContent: "center", flexWrap: "wrap", gap: "8px" }}>
            <button
              type="button"
              onClick={() => setDateFilter("all")}
              style={{
                padding: "8px 16px",
                borderRadius: "4px",
                fontSize: "14px",
                fontWeight: 500,
                border: "none",
                cursor: "pointer",
                backgroundColor: dateFilter === "all" ? "#00e054" : "rgba(68, 85, 102, 0.3)",
                color: dateFilter === "all" ? "#14181c" : "#9ab",
              }}
            >
              All time
            </button>
            {availableYears.map((year) => (
              <button
                key={year}
                type="button"
                onClick={() => setDateFilter(year)}
                style={{
                  padding: "8px 16px",
                  borderRadius: "4px",
                  fontSize: "14px",
                  fontWeight: 500,
                  border: "none",
                  cursor: "pointer",
                  backgroundColor: dateFilter === year ? "#00e054" : "rgba(68, 85, 102, 0.3)",
                  color: dateFilter === year ? "#14181c" : "#9ab",
                }}
              >
                {year}
              </button>
            ))}
          </section>
        )}  

        {/* Stats for the currently selected time range, deduped by film */}
        {films.length > 0 && (
          <section style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "24px" }}>
            {/* Key metrics row */}
            <div className="stats-row" style={{ display: "flex", justifyContent: "center", gap: "48px", textAlign: "center", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: "36px", fontWeight: 600, color: "#fff" }}>{totalEntries}</div>
                <div style={{ fontSize: "11px", color: "#9ab", marginTop: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>Films</div>
              </div>
              <div>
                <div style={{ fontSize: "36px", fontWeight: 600, color: "#fff" }}>{uniqueFilmCount}</div>
                <div style={{ fontSize: "11px", color: "#9ab", marginTop: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>Unique</div>
              </div>
              <div>
                <div style={{ fontSize: "36px", fontWeight: 600, color: "#fff" }}>{rewatchedFilmCount}</div>
                <div style={{ fontSize: "11px", color: "#9ab", marginTop: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>Rewatched</div>
              </div>
            </div>

          </section>
        )}

        {availableYears.length > 0 && (
          <section className="lb-heatmap-section">
            <div className="lb-heatmap-header">
              <h2>Watching Activity</h2>
              <p>Daily watches from your diary</p>
            </div>
            {dateFilter === "all" ? (
              <>
                <div ref={heatmapScrollRef} className="lb-heatmap-scroll">
                  {heatmapYears.map((year) => (
                    <HeatmapYear
                      key={year}
                      year={year}
                      counts={diaryDateCounts.get(year)}
                      compact
                      onHoverCell={(text, x, y) => {
                        const edge = 140;
                        const align =
                          x < edge ? "left" : x > window.innerWidth - edge ? "right" : "center";
                        setHeatmapTooltip({ text, x, y, align });
                      }}
                      onLeaveCell={() => setHeatmapTooltip(null)}
                    />
                  ))}
                </div>
                <div className="lb-heatmap-legend">
                  <span>Less</span>
                  {HEAT_COLORS.map((color, idx) => (
                    <span key={`all-legend-${idx}`} className="lb-heatmap-legend-swatch" style={{ backgroundColor: color }} />
                  ))}
                  <span>More</span>
                </div>
              </>
            ) : (
              <div className="lb-heatmap-single">
                <HeatmapYear
                  year={dateFilter}
                  counts={diaryDateCounts.get(dateFilter)}
                  onHoverCell={(text, x, y) => {
                    const edge = 140;
                    const align =
                      x < edge ? "left" : x > window.innerWidth - edge ? "right" : "center";
                    setHeatmapTooltip({ text, x, y, align });
                  }}
                  onLeaveCell={() => setHeatmapTooltip(null)}
                />
              </div>
            )}
          </section>
        )}

        {heatmapTooltip && (
          <div
            style={{
              position: "fixed",
              left: heatmapTooltip.x,
              top: heatmapTooltip.y - 12,
              transform:
                heatmapTooltip.align === "left"
                  ? "translate(0, -100%)"
                  : heatmapTooltip.align === "right"
                  ? "translate(-100%, -100%)"
                  : "translate(-50%, -100%)",
              background: "rgba(20, 24, 28, 0.95)",
              color: "#e2e8f0",
              border: "1px solid #345",
              borderRadius: "4px",
              padding: "4px 6px",
              fontSize: "11px",
              whiteSpace: "nowrap",
              boxShadow: "0 4px 10px rgba(0, 0, 0, 0.4)",
              pointerEvents: "none",
              zIndex: 1000,
            }}
          >
            {heatmapTooltip.text}
          </div>
        )}

        {/* TMDb enrichment stats - Always show if movieIndex exists or if we should debug */}
        {(movieIndex || scrapeStatus?.includes("ready")) && (
          <section id="film-breakdown" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "24px" }}>
            <div style={{ borderTop: "1px solid rgba(68, 85, 102, 0.5)", paddingTop: "24px", width: "100%", textAlign: "center" }}>
              <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#fff", marginBottom: "4px" }}>Film Breakdown</h2>
              {isLocalDev && !movieIndex && (
                <p style={{ fontSize: "14px", color: "#f87171", textAlign: "center" }}>
                  Warning: movieIndex is null/undefined. Check console for errors.
                </p>
              )}
            </div>
            {totalMoviesWithData > 0 ? (
              <>
                <p style={{ fontSize: "12px", color: "#9ab", textAlign: "center" }}>
                  Based on {totalMoviesWithData} films with TMDb data
                </p>
                {isLocalDev && (
                  <>
                    <p style={{ fontSize: "11px", color: "#678", textAlign: "center" }}>
                      Debug: {filteredUris.size} filtered URIs, {movieLookup ? Object.keys(movieLookup).length : 0} in lookup, {matchedMovies.filter((m: any) => m.tmdb_movie_id).length} tmdb_movie_id, {matchedMovies.filter((m: any) => m.tmdb_data).length} tmdb_data, {matchedMovies.filter((m: any) => m.tmdb_error || m.tmdb_api_error).length} TMDb errors
                    </p>
                    {topTmdbErrors.length > 0 && (
                      <p style={{ fontSize: "11px", color: "#678", textAlign: "center" }}>
                        Top errors: {topTmdbErrors.map(([msg, count]) => `${msg} (${count})`).join(", ")}
                      </p>
                    )}
                  </>
                )}

                {/* Pie charts grid */}
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "24px", padding: "8px 0" }}>
                  <StatPieChart
                    primaryValue={firstWatchEntryCount}
                    primaryLabel="New watches"
                    secondaryValue={rewatchEntryCount}
                    secondaryLabel="Rewatched"
                  />
                  <StatPieChart
                    primaryValue={directedByWoman}
                    primaryLabel="Directed by women"
                    secondaryValue={totalMoviesWithData - directedByWoman}
                    secondaryLabel="Not women"
                  />
                  <StatPieChart
                    primaryValue={writtenByWoman}
                    primaryLabel="Written by women"
                    secondaryValue={totalMoviesWithData - writtenByWoman}
                    secondaryLabel="Not women"
                  />
                  <StatPieChart
                    primaryValue={notAmerican}
                    primaryLabel="Non-American"
                    secondaryValue={totalMoviesWithData - notAmerican}
                    secondaryLabel="American"
                  />
                  <StatPieChart
                    primaryValue={notEnglish}
                    primaryLabel="Non-English"
                    secondaryValue={totalMoviesWithData - notEnglish}
                    secondaryLabel="English"
                  />
                  <StatPieChart
                    primaryValue={inCriterion}
                    primaryLabel="In Criterion"
                    secondaryValue={totalMoviesWithData - inCriterion}
                    secondaryLabel="Not in Criterion"
                  />
                </div>

                <DiaryTable
                  moviesWithData={moviesWithData}
                  diaryFilters={diaryFilters}
                  setDiaryFilters={setDiaryFilters}
                  diarySortColumn={diarySortColumn}
                  setDiarySortColumn={setDiarySortColumn}
                  diarySortState={diarySortState}
                  setDiarySortState={setDiarySortState}
                />

              </>
            ) : (
              <div className="text-sm text-slate-400 space-y-2">
                <p>
                  No TMDb data available for the current filter. Make sure you enabled TMDb enrichment when uploading your diary.
                </p>
                <div className="text-xs space-y-1 mt-2 p-2 bg-slate-800/50 rounded">
                  <p className="font-medium">Debug info:</p>
                  <p>• Movies in index: {movieIndex ? Object.keys(movieIndex).length : 0} (lookup: {movieLookup ? Object.keys(movieLookup).length : 0})</p>
                  <p>• URI map entries: {uriMap ? Object.keys(uriMap).length : 0}</p>
                  <p>• URIs in filtered rows: {filteredUris.size}</p>
                  <p>• Canonicalized URIs: {canonicalizedFilteredUris.size}</p>
                  <p>• Movies with TMDb data: {totalMoviesWithData}</p>
                  {movieIndex && Object.keys(movieIndex).length > 0 && (
                    <p>• Sample movieIndex key: {Object.keys(movieIndex)[0]}</p>
                  )}
                  {filteredUris.size > 0 && (
                    <p>• Sample filtered URI: {Array.from(filteredUris)[0]}</p>
                  )}
                  {canonicalizedFilteredUris.size > 0 && (
                    <p>• Sample canonicalized: {Array.from(canonicalizedFilteredUris)[0]}</p>
                  )}
                  {movieIndex && Object.keys(movieIndex).length > 0 && (
                    <p>• Sample movie from index has tmdb_data: {String(!!(Object.values(movieIndex)[0] as any)?.tmdb_data)}</p>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Rating breakdown for this range */}
        {rows.length > 0 && (
          <section style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "24px" }}>
            <div style={{ borderTop: "1px solid rgba(68, 85, 102, 0.5)", paddingTop: "24px", width: "100%", textAlign: "center" }}>
              <h2 style={{ fontSize: "18px", fontWeight: 600, color: "#fff", marginBottom: "16px" }}>Ratings</h2>
              {ratingCount === 0 && (
                <p style={{ fontSize: "12px", color: "#9ab", marginTop: "-8px" }}>
                  No ratings found in this file.
                </p>
              )}
              {ratingFilter && (
                <div style={{ fontSize: "12px", color: "#9ab", marginTop: "-8px" }}>
                  Filtering diary list and pie charts for rating {ratingFilter}★ — check Film Breakdown above.
                  <button
                    onClick={() => {
                      const section = document.getElementById("diary-list");
                      if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                    style={{
                      marginLeft: "8px",
                      padding: "2px 6px",
                      fontSize: "11px",
                      backgroundColor: "transparent",
                      border: "1px solid #456",
                      borderRadius: "4px",
                      color: "#9ab",
                      cursor: "pointer",
                    }}
                  >
                    Jump to list
                  </button>
                  <button
                    onClick={() => setRatingFilter(null)}
                    style={{
                      marginLeft: "8px",
                      padding: "2px 6px",
                      fontSize: "11px",
                      backgroundColor: "transparent",
                      border: "1px solid #456",
                      borderRadius: "4px",
                      color: "#9ab",
                      cursor: "pointer",
                    }}
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>

            {/* Rating stats row */}
            <div className="stats-row" style={{ display: "flex", justifyContent: "center", gap: "48px", textAlign: "center", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: "32px", fontWeight: 600, color: "#fff" }}>
                  {ratingCount > 0 ? averageRating.toFixed(1) : "—"}
                </div>
                <div style={{ fontSize: "11px", color: "#9ab", marginTop: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>Average</div>
              </div>
              <div>
                <div style={{ fontSize: "32px", fontWeight: 600, color: "#fff" }}>
                  {ratingCount > 0 ? medianRating.toFixed(1) : "—"}
                </div>
                <div style={{ fontSize: "11px", color: "#9ab", marginTop: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>Median</div>
              </div>
              <div>
                <div style={{ fontSize: "32px", fontWeight: 600, color: "#fff" }}>{ratingCount}</div>
                <div style={{ fontSize: "11px", color: "#9ab", marginTop: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>Rated</div>
              </div>
              <div>
                <div style={{ fontSize: "32px", fontWeight: 600, color: "#fff" }}>{fourPlusCount}</div>
                <div style={{ fontSize: "11px", color: "#9ab", marginTop: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>4★+</div>
              </div>
            </div>

            {/* Bar chart */}
            <div style={{ width: "100%", height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={ratingChartData}
                  margin={{ top: 10, right: 10, left: 0, bottom: 10 }}
                >
                  <XAxis
                    dataKey="rating"
                    tick={{ fontSize: 11, fill: "#9ab" }}
                    tickLine={false}
                    axisLine={{ stroke: "#456" }}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 10, fill: "#9ab" }}
                    tickLine={false}
                    axisLine={false}
                    width={30}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(68, 85, 102, 0.3)" }}
                    content={<RatingTooltip />}
                  />
                  <Bar
                    dataKey="count"
                    radius={[3, 3, 0, 0]}
                    isAnimationActive={false}
                    onClick={(data: any) => {
                      const rating = data?.payload?.rating;
                      if (rating) toggleRatingFilter(String(rating));
                    }}
                  >
                    {ratingChartData.map((entry) => (
                      <Cell
                        key={`rating-${entry.rating}`}
                        fill={ratingFilter && ratingFilter !== entry.rating ? "#345" : "#00e054"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

          </section>
        )}

        {/* Decade distribution bars */}
        {totalMoviesWithData > 0 && (
          <section style={{ display: "flex", flexDirection: "column", gap: "20px", width: "100%" }}>
            {decadeFilter && (
              <div style={{ fontSize: "12px", color: "#9ab", textAlign: "center" }}>
                Filtering diary list and pie charts for {decadeFilter.label} — check Film Breakdown above.
                <button
                  onClick={() => {
                    const section = document.getElementById("diary-list");
                    if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  style={{
                    marginLeft: "8px",
                    padding: "2px 6px",
                    fontSize: "11px",
                    backgroundColor: "transparent",
                    border: "1px solid #456",
                    borderRadius: "4px",
                    color: "#9ab",
                    cursor: "pointer",
                  }}
                >
                  Jump to list
                </button>
                <button
                  onClick={() => setDecadeFilter(null)}
                  style={{
                    marginLeft: "8px",
                    padding: "2px 6px",
                    fontSize: "11px",
                    backgroundColor: "transparent",
                    border: "1px solid #456",
                    borderRadius: "4px",
                    color: "#9ab",
                    cursor: "pointer",
                  }}
                >
                  Clear
                </button>
              </div>
            )}
            {/* Decade distribution bar */}
            {(() => {
              // Group movies by decade
              const decadeCounts: Record<string, number> = {};
              for (const movie of moviesWithData) {
                const releaseDate = (movie as any).tmdb_data?.release_date;
                if (typeof releaseDate === "string" && releaseDate.length >= 4) {
                  const year = parseInt(releaseDate.slice(0, 4), 10);
                  if (!isNaN(year)) {
                    const decade = `${Math.floor(year / 10) * 10}s`;
                    decadeCounts[decade] = (decadeCounts[decade] || 0) + 1;
                  }
                }
              }

              // Sort decades chronologically
              const sortedDecades = Object.entries(decadeCounts)
                .sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

              if (sortedDecades.length === 0) return null;

              let decadeRunningPercent = 0;
              const decadeSegments = sortedDecades.map(([decade, count]) => {
                const percent = (count / totalMoviesWithData) * 100;
                const startPercent = decadeRunningPercent;
                decadeRunningPercent += percent;
                return { decade, count, percent, startPercent };
              });

              // Color palette for decades (gradient from warm to cool)
              const decadeColors: Record<string, string> = {
                "1920s": "#8b4513",
                "1930s": "#cd853f",
                "1940s": "#daa520",
                "1950s": "#f4a460",
                "1960s": "#ff6347",
                "1970s": "#ff4500",
                "1980s": "#9932cc",
                "1990s": "#4169e1",
                "2000s": "#00ced1",
                "2010s": "#32cd32",
                "2020s": "#00e054",
              };

              const getDecadeColor = (decade: string) => {
                return decadeColors[decade] || "#678";
              };

              return (
                <div style={{ width: "100%" }}>
                  <h3 style={{ fontSize: "14px", fontWeight: 500, color: "#9ab", marginBottom: "6px", textAlign: "center" }}>
                    Films by Decade
                  </h3>
                  <div style={{ position: "relative" }}>
                    {decadeHover && (
                      <span
                        style={{
                          position: "absolute",
                          top: "-28px",
                          left: `${decadeHover.midPercent}%`,
                          transform: "translateX(-50%)",
                          fontSize: "12px",
                          color: "#9ab",
                          backgroundColor: "rgba(20, 24, 28, 0.9)",
                          border: "1px solid #345",
                          borderRadius: "4px",
                          padding: "2px 6px",
                          whiteSpace: "nowrap",
                          boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
                          pointerEvents: "none",
                        }}
                      >
                        {decadeHover.label}: {decadeHover.count} films ({Math.round(decadeHover.percent)}%)
                      </span>
                    )}
                    <div
                      style={{
                        display: "flex",
                        width: "100%",
                        height: "32px",
                        borderRadius: "6px",
                        overflow: "hidden",
                        backgroundColor: "#345",
                      }}
                    >
                      {decadeSegments.map(({ decade, count, percent, startPercent }) => {
                        const midPercent = startPercent + percent / 2;
                        return (
                            <div
                              key={decade}
                              style={{
                                width: `${percent}%`,
                                height: "100%",
                                backgroundColor: getDecadeColor(decade),
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                cursor: "pointer",
                                transition: "opacity 0.2s ease",
                                minWidth: percent > 3 ? "auto" : "0",
                              }}
                              onClick={() => toggleDecadeFilter("decade", decade)}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.opacity = "0.8";
                                setDecadeHover({ label: decade, count, percent, midPercent });
                              }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.opacity = "1";
                              setDecadeHover(null);
                            }}
                          >
                            {percent >= 8 && (
                              <span style={{ fontSize: "11px", fontWeight: 600, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>
                                {decade.slice(0, 4)}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {/* Legend */}
                  <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "12px", marginTop: "12px" }}>
                    {sortedDecades.map(([decade, count]) => {
                      const percent = Math.round((count / totalMoviesWithData) * 100);
                      return (
                        <div key={decade} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                          <div style={{ width: "12px", height: "12px", borderRadius: "2px", backgroundColor: getDecadeColor(decade) }} />
                          <span style={{ fontSize: "11px", color: "#9ab" }}>{decade} ({percent}%)</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Offset decade bar (1906-1915, 1916-1925, etc.) */}
            {(() => {
              // Group movies by offset decades (years ending in 6 to years ending in 5)
              const offsetDecadeCounts: Record<string, number> = {};
              for (const movie of moviesWithData) {
                const releaseDate = (movie as any).tmdb_data?.release_date;
                if (typeof releaseDate === "string" && releaseDate.length >= 4) {
                  const year = parseInt(releaseDate.slice(0, 4), 10);
                  if (!isNaN(year)) {
                    // Calculate offset decade: 1906-1915, 1916-1925, etc.
                    const decadeStart = Math.floor((year - 6) / 10) * 10 + 6;
                    const decadeEnd = decadeStart + 9;
                    const decadeLabel = `${decadeStart}-${decadeEnd}`;
                    offsetDecadeCounts[decadeLabel] = (offsetDecadeCounts[decadeLabel] || 0) + 1;
                  }
                }
              }

              // Sort decades chronologically
              const sortedOffsetDecades = Object.entries(offsetDecadeCounts)
                .sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

              if (sortedOffsetDecades.length === 0) return null;

              let offsetRunningPercent = 0;
              const offsetSegments = sortedOffsetDecades.map(([decade, count]) => {
                const percent = (count / totalMoviesWithData) * 100;
                const startPercent = offsetRunningPercent;
                offsetRunningPercent += percent;
                return { decade, count, percent, startPercent };
              });

              // Color palette for offset decades (different hues)
              const offsetDecadeColors: Record<string, string> = {
                "1896-1905": "#4a1c6b",
                "1906-1915": "#6b2d5b",
                "1916-1925": "#8b3d4b",
                "1926-1935": "#ab4d3b",
                "1936-1945": "#cb6d2b",
                "1946-1955": "#db8d1b",
                "1956-1965": "#dbad0b",
                "1966-1975": "#bbcd0b",
                "1976-1985": "#7bcd2b",
                "1986-1995": "#3bbd4b",
                "1996-2005": "#1b9d6b",
                "2006-2015": "#0b7d8b",
                "2016-2025": "#1b5dab",
              };

              const getOffsetDecadeColor = (decade: string) => {
                return offsetDecadeColors[decade] || "#678";
              };

              return (
                <div style={{ width: "100%" }}>
                  <h3 style={{ fontSize: "14px", fontWeight: 500, color: "#9ab", marginBottom: "6px", textAlign: "center" }}>
                    Films by Offset Decade
                  </h3>
                  <div style={{ position: "relative" }}>
                    {offsetDecadeHover && (
                      <span
                        style={{
                          position: "absolute",
                          top: "-28px",
                          left: `${offsetDecadeHover.midPercent}%`,
                          transform: "translateX(-50%)",
                          fontSize: "12px",
                          color: "#9ab",
                          backgroundColor: "rgba(20, 24, 28, 0.9)",
                          border: "1px solid #345",
                          borderRadius: "4px",
                          padding: "2px 6px",
                          whiteSpace: "nowrap",
                          boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
                          pointerEvents: "none",
                        }}
                      >
                        {offsetDecadeHover.label}: {offsetDecadeHover.count} films ({Math.round(offsetDecadeHover.percent)}%)
                      </span>
                    )}
                    <div
                      style={{
                        display: "flex",
                        width: "100%",
                        height: "32px",
                        borderRadius: "6px",
                        overflow: "hidden",
                        backgroundColor: "#345",
                      }}
                    >
                      {offsetSegments.map(({ decade, count, percent, startPercent }) => {
                        const midPercent = startPercent + percent / 2;
                        return (
                          <div
                            key={decade}
                            style={{
                              width: `${percent}%`,
                              height: "100%",
                              backgroundColor: getOffsetDecadeColor(decade),
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              cursor: "pointer",
                              transition: "opacity 0.2s ease",
                              minWidth: percent > 3 ? "auto" : "0",
                            }}
                            onClick={() => toggleDecadeFilter("offset", decade)}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.opacity = "0.8";
                              setOffsetDecadeHover({ label: decade, count, percent, midPercent });
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.opacity = "1";
                              setOffsetDecadeHover(null);
                            }}
                          >
                            {percent >= 10 && (
                              <span style={{ fontSize: "10px", fontWeight: 600, color: "#fff", textShadow: "0 1px 2px rgba(0,0,0,0.5)" }}>
                                {decade.slice(2, 4)}-{decade.slice(-2)}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {/* Legend */}
                  <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "12px", marginTop: "12px" }}>
                    {sortedOffsetDecades.map(([decade, count]) => {
                      const percent = Math.round((count / totalMoviesWithData) * 100);
                      return (
                        <div key={decade} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                          <div style={{ width: "12px", height: "12px", borderRadius: "2px", backgroundColor: getOffsetDecadeColor(decade) }} />
                          <span style={{ fontSize: "11px", color: "#9ab" }}>{decade} ({percent}%)</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </section>
        )}

        {/* World map by country/continent */}
        {moviesWithDataBase.length > 0 && (() => {
          const worldMap = world as any;
          const getCountryName = (code: string, fallback?: string) =>
            (countries as Record<string, any>)[code]?.name || fallback || code;

          const getFillForLocation = (codeLower: string) => {
            const code = codeLower.toUpperCase();
            const cont = getContinentCode(code);
            if (geoView === "continent") {
              if (!cont) return "#1b2026";
              const base = continentColors[cont] || "#334";
              const intensity = (continentCounts[cont] || 0) / maxContinentCount;
              return mixHex("#1b2026", base, Math.min(1, 0.2 + intensity * 0.8));
            }
            const count = countryCounts[code] || 0;
            if (count === 0) return "#1b2026";
            const intensity = count / maxCountryCount;
            return mixHex("#1b2026", "#00e054", Math.min(1, 0.2 + intensity * 0.8));
          };

          const isSelectedLocation = (codeLower: string) => {
            if (!geoFilter) return false;
            const code = codeLower.toUpperCase();
            if (geoFilter.type === "country") {
              return geoFilter.value.toUpperCase() === code;
            }
            const cont = getContinentCode(code);
            return cont === geoFilter.value;
          };

          return (
            <section style={{ display: "flex", flexDirection: "column", gap: "12px", width: "100%" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                <h3 style={{ fontSize: "14px", fontWeight: 600, color: "#9ab" }}>World Map</h3>
                <div style={{ display: "flex", gap: "8px" }}>
                  {(["continent", "country"] as const).map((view) => (
                    <button
                      key={view}
                      type="button"
                      onClick={() => setGeoView(view)}
                      style={{
                        padding: "4px 8px",
                        borderRadius: "6px",
                        border: "1px solid #456",
                        backgroundColor: geoView === view ? "#00e054" : "transparent",
                        color: geoView === view ? "#14181c" : "#9ab",
                        fontSize: "11px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {view === "continent" ? "Continent" : "Country"}
                    </button>
                  ))}
                </div>
              </div>

              {geoFilter && (
                <div style={{ fontSize: "12px", color: "#9ab", textAlign: "center" }}>
                  Filtering diary list and pie charts for {geoFilter.type === "continent"
                    ? getContinentLabel(geoFilter.value)
                    : getCountryName(geoFilter.value)} — check Film Breakdown above.
                  <button
                    onClick={() => {
                      const section = document.getElementById("diary-list");
                      if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                    style={{
                      marginLeft: "8px",
                      padding: "2px 6px",
                      fontSize: "11px",
                      backgroundColor: "transparent",
                      border: "1px solid #456",
                      borderRadius: "4px",
                      color: "#9ab",
                      cursor: "pointer",
                    }}
                  >
                    Jump to list
                  </button>
                  <button
                    onClick={() => setGeoFilter(null)}
                    style={{
                      marginLeft: "8px",
                      padding: "2px 6px",
                      fontSize: "11px",
                      backgroundColor: "transparent",
                      border: "1px solid #456",
                      borderRadius: "4px",
                      color: "#9ab",
                      cursor: "pointer",
                    }}
                  >
                    Clear
                  </button>
                </div>
              )}

              <div
                ref={mapWrapperRef}
                style={{ position: "relative", width: "100%", backgroundColor: "#101419", borderRadius: "8px", padding: "8px" }}
              >
                {geoHover && (
                  <div
                    style={{
                      position: "absolute",
                      left: geoHover.x,
                      top: geoHover.y,
                      transform: "translate(-50%, -120%)",
                      backgroundColor: "rgba(20, 24, 28, 0.95)",
                      border: "1px solid #345",
                      borderRadius: "6px",
                      padding: "4px 8px",
                      fontSize: "12px",
                      color: "#e2e8f0",
                      pointerEvents: "none",
                      whiteSpace: "nowrap",
                      boxShadow: "0 6px 16px rgba(0,0,0,0.35)",
                    }}
                  >
                    {geoHover.label}: {geoHover.count} films
                  </div>
                )}
                <svg
                  viewBox={worldMap.viewBox}
                  style={{ width: "100%", height: "auto" }}
                  role="img"
                  aria-label="World map"
                >
                  {worldMap.locations.map((loc: any) => {
                    const codeLower = loc.id;
                    const code = codeLower.toUpperCase();
                    const cont = getContinentCode(code);
                    const countryCount = countryCounts[code] || 0;
                    const continentCount = cont ? (continentCounts[cont] || 0) : 0;
                    const label = geoView === "continent"
                      ? (cont ? getContinentLabel(cont) : "Unknown")
                      : getCountryName(code, loc.name);
                    const hoverCount = geoView === "continent" ? continentCount : countryCount;
                    const clickable = geoView === "continent" ? Boolean(cont && continentCount > 0) : countryCount > 0;

                    return (
                      <path
                        key={loc.id}
                        d={loc.path}
                        fill={getFillForLocation(codeLower)}
                        stroke={isSelectedLocation(codeLower) ? "#00e054" : "#222831"}
                        strokeWidth={isSelectedLocation(codeLower) ? 0.8 : 0.4}
                        style={{ cursor: clickable ? "pointer" : "default", transition: "fill 0.2s ease" }}
                        onMouseEnter={(e) => {
                          const rect = mapWrapperRef.current?.getBoundingClientRect();
                          if (!rect) return;
                          setGeoHover({
                            label,
                            count: hoverCount,
                            x: e.clientX - rect.left,
                            y: e.clientY - rect.top,
                          });
                        }}
                        onMouseMove={(e) => {
                          const rect = mapWrapperRef.current?.getBoundingClientRect();
                          if (!rect) return;
                          setGeoHover((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  x: e.clientX - rect.left,
                                  y: e.clientY - rect.top,
                                }
                              : {
                                  label,
                                  count: hoverCount,
                                  x: e.clientX - rect.left,
                                  y: e.clientY - rect.top,
                                }
                          );
                        }}
                        onMouseLeave={() => setGeoHover(null)}
                        onClick={() => {
                          if (!clickable) return;
                          if (geoView === "continent" && cont) {
                            setGeoFilter((prev) => (prev && prev.type === "continent" && prev.value === cont ? null : { type: "continent", value: cont }));
                          }
                          if (geoView === "country") {
                            setGeoFilter((prev) => (prev && prev.type === "country" && prev.value === code ? null : { type: "country", value: code }));
                          }
                        }}
                      />
                    );
                  })}
                </svg>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center" }}>
                {CONTINENT_ORDER.map((cont) => {
                  const count = continentCounts[cont] || 0;
                  const label = getContinentLabel(cont);
                  const isActive = geoFilter?.type === "continent" && geoFilter.value === cont;
                  return (
                    <button
                      key={cont}
                      type="button"
                      onClick={() => setGeoFilter((prev) => (prev && prev.type === "continent" && prev.value === cont ? null : { type: "continent", value: cont }))}
                      style={{
                        padding: "4px 8px",
                        borderRadius: "999px",
                        border: "1px solid #456",
                        backgroundColor: isActive ? "#00e054" : "transparent",
                        color: isActive ? "#14181c" : "#9ab",
                        fontSize: "11px",
                        fontWeight: 600,
                        cursor: count > 0 ? "pointer" : "default",
                        opacity: count > 0 ? 1 : 0.5,
                      }}
                    >
                      {label} ({count})
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })()}

        {/* Review stats - only show if reviews have been uploaded */}
        {reviews.length > 0 && (() => {
          // Calculate word counts for each review
          const wordCounts = reviews.map((review) => {
            const text = review.Review || "";
            const words = text.trim().split(/\s+/).filter(w => w.length > 0);
            return words.length;
          });

          // Calculate median word count
          const sortedWordCounts = [...wordCounts].sort((a, b) => a - b);
          const mid = Math.floor(sortedWordCounts.length / 2);
          const medianWordCount = sortedWordCounts.length % 2 === 1
            ? sortedWordCounts[mid]
            : Math.round((sortedWordCounts[mid - 1] + sortedWordCounts[mid]) / 2);

          // Calculate average for comparison
          const totalWords = wordCounts.reduce((sum, count) => sum + count, 0);
          const avgWordCount = Math.round(totalWords / wordCounts.length);

          return (
            <section style={{ borderTop: "1px solid rgba(68, 85, 102, 0.5)", paddingTop: "24px", width: "100%" }}>
              <h3 style={{ fontSize: "16px", fontWeight: 600, color: "#fff", marginBottom: "16px", textAlign: "center" }}>
                Reviews
              </h3>
              <div className="stats-row" style={{ display: "flex", justifyContent: "center", gap: "48px", textAlign: "center", flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: "32px", fontWeight: 600, color: "#fff" }}>{reviews.length}</div>
                  <div style={{ fontSize: "11px", color: "#9ab", marginTop: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>Reviews</div>
                </div>
                <div>
                  <div style={{ fontSize: "32px", fontWeight: 600, color: "#fff" }}>{medianWordCount}</div>
                  <div style={{ fontSize: "11px", color: "#9ab", marginTop: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>Median Words</div>
                </div>
                <div>
                  <div style={{ fontSize: "32px", fontWeight: 600, color: "#fff" }}>{avgWordCount}</div>
                  <div style={{ fontSize: "11px", color: "#9ab", marginTop: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>Avg Words</div>
                </div>
                <div>
                  <div style={{ fontSize: "32px", fontWeight: 600, color: "#fff" }}>{totalWords.toLocaleString()}</div>
                  <div style={{ fontSize: "11px", color: "#9ab", marginTop: "4px", textTransform: "uppercase", letterSpacing: "1px" }}>Total Words</div>
                </div>
              </div>
            </section>
          );
        })()}

        {/* Watchlist Analysis Section */}
        <section style={{ backgroundColor: "rgba(68, 85, 102, 0.2)", borderRadius: "8px", padding: "24px", marginTop: "32px" }}>
          <h2 style={{ fontSize: "20px", fontWeight: 600, color: "#fff", marginBottom: "16px", textAlign: "center" }}>
            Watchlist Analysis
          </h2>
          <p style={{ fontSize: "12px", color: "#678", marginBottom: "16px", textAlign: "center" }}>
            Upload your watchlist.csv to find films matching your criteria
          </p>

          <div style={{ marginBottom: "16px" }}>
            <input
              id="watchlist-file-input"
              type="file"
              accept=".csv"
              onChange={handleWatchlistChange}
              disabled={isWatchlistLoading}
              style={{ display: "none" }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "13px", color: "#9ab" }}>Choose file:</span>
              <label
                htmlFor="watchlist-file-input"
                style={{
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid #4b5a66",
                  backgroundColor: "#1b2026",
                  color: "#e2e8f0",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: isWatchlistLoading ? "not-allowed" : "pointer",
                  boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.05)",
                  opacity: isWatchlistLoading ? 0.6 : 1,
                }}
              >
                {watchlistFileName}
              </label>
              <button
                type="button"
                disabled={isWatchlistLoading}
                onClick={async () => {
                  try {
                    const file = await loadSampleCsv("/kat_watchlist.csv", "kat_watchlist.csv");
                    setWatchlistFileName(file.name);
                    await processWatchlistFile(file);
                  } catch (e: any) {
                    setError(e.message || "Failed to load sample watchlist");
                  }
                }}
                style={{
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: "1px solid #456",
                  backgroundColor: "transparent",
                  color: "#9ab",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: isWatchlistLoading ? "not-allowed" : "pointer",
                  opacity: isWatchlistLoading ? 0.6 : 1,
                }}
              >
                Try with Kat's
              </button>
            </div>
          </div>

          {/* Loading state */}
          {isWatchlistLoading && (
            <div style={{ marginTop: "16px" }}>
              <LoadingSpinner message={watchlistStatus || "Processing..."} />
              <div style={{ marginTop: "8px" }}>
                <div style={{
                  height: "6px",
                  width: "100%",
                  backgroundColor: "rgba(68, 85, 102, 0.3)",
                  borderRadius: "3px",
                  overflow: "hidden"
                }}>
                  {watchlistProgress && watchlistProgress.total > 0 ? (
                    <div
                      style={{
                        height: "100%",
                        borderRadius: "3px",
                        backgroundColor: "#00e054",
                        width: `${Math.min(100, Math.round((watchlistProgress.current / watchlistProgress.total) * 100))}%`,
                        transition: "width 0.3s ease"
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        height: "100%",
                        borderRadius: "3px",
                        backgroundColor: "#00e054",
                        width: "30%",
                        animation: "indeterminate 1.5s ease-in-out infinite",
                      }}
                    />
                  )}
                </div>
                {watchlistProgress && watchlistProgress.total > 0 ? (
                  <p style={{ fontSize: "12px", color: "#678", textAlign: "center", marginTop: "4px" }}>
                    {watchlistProgress.current} / {watchlistProgress.total} ({Math.round((watchlistProgress.current / watchlistProgress.total) * 100)}%)
                  </p>
                ) : (
                  <p style={{ fontSize: "12px", color: "#678", textAlign: "center", marginTop: "4px" }}>
                    Connecting to server...
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Status message when not loading */}
          {!isWatchlistLoading && watchlistStatus && (
            <p style={{ fontSize: "14px", color: "#9ab", textAlign: "center", marginBottom: "16px" }}>
              {watchlistStatus}
            </p>
          )}

          {!isWatchlistLoading && isLocalDev && (
            <div style={{ display: "flex", justifyContent: "center", marginBottom: "12px" }}>
              <label style={{ fontSize: "12px", color: "#9ab", display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="checkbox"
                  checked={watchlistUseVercelApi}
                  onChange={(e) => setWatchlistUseVercelApi(e.target.checked)}
                />
                Use Vercel API for watchlist (uses prod cache)
              </label>
            </div>
          )}

          {!isWatchlistLoading && isLocalDev && watchlistMissingCount > 0 && (
            <div style={{ marginBottom: "16px", backgroundColor: "rgba(20, 24, 28, 0.7)", border: "1px solid #345", borderRadius: "6px", padding: "12px" }}>
              <div style={{ fontSize: "12px", color: "#9ab", marginBottom: "8px" }}>
                Debug: {watchlistMissingCount} watchlist entries missing TMDb data (showing {watchlistMissingSamples.length}) • uriMap: {watchlistUriMapSize} entries
              </div>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "6px" }}>
                {watchlistMissingDebug.map((row, idx) => (
                  <li key={`${row.originalUri}-${idx}`} style={{ fontSize: "12px", color: "#ccd" }}>
                    <span style={{ color: "#def" }}>{row.name || "Untitled"}</span>
                    {row.year ? ` (${row.year})` : ""}
                    <span style={{ color: "#678", marginLeft: "6px" }}>{row.originalUri}</span>
                    <span style={{ color: "#678", marginLeft: "6px" }}>
                      map:{row.hadUriMap ? "yes" : "no"} lookup:{row.foundInLookup ? "yes" : "no"}
                    </span>
                    {row.tmdbId ? (
                      <span style={{ color: "#678", marginLeft: "6px" }}>tmdbId:{row.tmdbId}</span>
                    ) : null}
                    {row.tmdbError ? (
                      <span style={{ color: "#c77", marginLeft: "6px" }}>error:{String(row.tmdbError).slice(0, 80)}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Results table */}
          {watchlistMovies.length > 0 && (
            <WatchlistTable
              watchlistMovies={watchlistMovies}
              watchlistFilters={watchlistFilters}
              setWatchlistFilters={setWatchlistFilters}
              watchlistRuntimeFilter={watchlistRuntimeFilter}
              setWatchlistRuntimeFilter={setWatchlistRuntimeFilter}
              watchlistSortColumn={watchlistSortColumn}
              setWatchlistSortColumn={setWatchlistSortColumn}
              watchlistSortState={watchlistSortState}
              setWatchlistSortState={setWatchlistSortState}
              watchlistContinentFilter={watchlistContinentFilter}
              setWatchlistContinentFilter={setWatchlistContinentFilter}
            />
          )}
        </section>
      </div>
      <div style={{ fontSize: "12px", color: "#9ab", margin: "40px 0 24px", textAlign: "center" }}>
        <a
          href="https://letterboxd.com/katswnt"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: "#9ab",
            textDecoration: "none",
            display: "inline-block",
            padding: "8px 14px",
            borderRadius: "6px",
            border: "1px solid #456",
            backgroundColor: "rgba(68, 85, 102, 0.25)",
            fontWeight: 600,
          }}
        >
          Follow me on Letterboxd!
        </a>
      </div>
    </main>
  );
}

export default App;

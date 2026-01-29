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
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  CartesianGrid,
  ScatterChart,
  Scatter,
} from "recharts";
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

type RssEntry = {
  title: string;
  year: string;
  rating: string;
  watchedDate: string;
  rewatch: string;
  link: string;
  pubDate: string;
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
  byBlackDirector: boolean;
  notAmerican: boolean;
  notEnglish: boolean;
  inCriterion: boolean;
  criteriaCount: number;
};

// Runtime filter options
type RuntimeFilter = "all" | "under90" | "under2h" | "under2.5h" | "over2.5h";

// Sort state for watchlist columns
type WatchlistSortState = "default" | "asc" | "desc";
type WatchlistSortColumn = "name" | "director" | "year" | "runtime" | "rating" | null;
type DecadeFilter = { type: "decade" | "offset"; label: string } | null;
type GeoFilter = { type: "continent" | "country"; value: string } | null;
type GeoView = "continent" | "country";
type CuratedListMeta = {
  name: string;
  count: number;
  ranked?: boolean;
};

type CuratedFilm = {
  name: string;
  year: number | null;
  url: string;
  listCount: number;
  lists: Record<string, number>;
  tmdb_movie_id?: number;
  tmdb_data?: any;
  tmdb_error?: string;
  is_by_black_director?: boolean;
};

type CuratedListsPayload = {
  lists: Record<string, CuratedListMeta>;
  films: CuratedFilm[];
};

type WatchlistBuilderState = {
  count: number;
  quality: "any" | "critically-acclaimed" | "highest-rated" | "imdb-popularity";
  directorMode: "any" | "all";
  directorWomen: boolean;
  directorBlack: boolean;
  writerWomen: boolean;
  listMode: "any" | "all";
  listSources: string[];
  shuffleSeed: number;
  shuffleAllSeed: number | null;
  origin: "anywhere" | "not-usa" | "non-english" | "africa" | "asia" | "europe" | "latin-america" | "middle-east" | "oceania";
  seen: "havent-seen" | "have-seen" | "any";
  watchlistBias: "any" | "prefer" | "exclude";
};

const CONTINENT_ORDER = ["AF", "AS", "EU", "NA", "SA", "OC", "AN"] as const;

const getContinentCode = (countryCode: string | undefined | null) => {
  if (!countryCode) return null;
  const upper = countryCode.toUpperCase();
  const entry = (countries as Record<string, any>)[upper];
  return entry?.continent || null;
};

const getContinentLabel = (code: string) =>
  (continents as Record<string, string>)[code] || code;

const getCountryName = (code: string, fallback?: string) =>
  (countries as Record<string, any>)[code]?.name || fallback || code;

const CONTINENT_COLORS: Record<string, string> = {
  AF: "#FF8002",
  AS: "#f59e0b",
  EU: "#3EBDF4",
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

const BlackDirectorsInfo = ({ align = "center" }: { align?: "left" | "center" | "right" }) => {
  const [open, setOpen] = useState(false);
  return (
    <span className={`lb-info lb-info-${align}`}>
      <button
        type="button"
        className="lb-info-btn"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        aria-label="About the Black directors list"
      >
        i
      </button>
      {open && (
        <span
          className="lb-info-panel"
          onClick={(e) => e.stopPropagation()}
        >
          This is a manually compiled list, and is a deduped combination of{" "}
          <a
            href="https://letterboxd.com/squirrel22/list/films-by-black-directors/"
            target="_blank"
            rel="noreferrer"
          >
            Squirrel22&apos;s Films by Black Directors list
          </a>{" "}
          and{" "}
          <a
            href="https://letterboxd.com/melissa90s/list/black-directors/"
            target="_blank"
            rel="noreferrer"
          >
            Melissa&apos;s BLACK DIRECTORS list
          </a>
          . If I&apos;m missing a film, please comment on the{" "}
          <a
            href="https://letterboxd.com/katswnt/list/movies-by-black-directors/"
            target="_blank"
            rel="noreferrer"
          >
            Letterboxd list
          </a>{" "}
          or dm me on{" "}
          <a
            href="https://x.com/katswint"
            target="_blank"
            rel="noreferrer"
          >
            Twitter
          </a>
          , and I&apos;ll be happy to add it. This list isn&apos;t exhaustive—there are many films by Black
          directors beyond it. We&apos;re working on a similar list for Black writers.
        </span>
      )}
    </span>
  );
};

const sanitizeReviewHtml = (input: string) => {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return input;
  }
  const doc = new DOMParser().parseFromString(input, "text/html");
  const allowed = new Set(["A", "B", "STRONG", "I", "EM", "BR"]);
  const sanitizeNode = (node: Element) => {
    const children = Array.from(node.children);
    for (const child of children) {
      if (!allowed.has(child.tagName)) {
        child.replaceWith(doc.createTextNode(child.textContent || ""));
        continue;
      }
      if (child.tagName === "A") {
        const href = child.getAttribute("href") || "";
        if (!/^https?:\/\//i.test(href)) {
          child.replaceWith(doc.createTextNode(child.textContent || ""));
          continue;
        }
        child.setAttribute("target", "_blank");
        child.setAttribute("rel", "noopener noreferrer");
      }
      sanitizeNode(child);
    }
  };
  sanitizeNode(doc.body);
  return doc.body.innerHTML;
};

const TrendInfo = ({ align = "center" }: { align?: "left" | "center" | "right" }) => {
  const [open, setOpen] = useState(false);
  return (
    <span className={`lb-info lb-info-${align}`}>
      <button
        type="button"
        className="lb-info-btn"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        aria-label="About trend calculations"
      >
        i
      </button>
      {open && (
        <span
          className="lb-info-panel"
          onClick={(e) => e.stopPropagation()}
        >
          Trend compares the 3-month moving average over the last 12 months to show
          whether each metric is rising, steady, or falling.
        </span>
      )}
    </span>
  );
};


// Memoized WorldMap component to prevent re-renders on hover
const WorldMap = memo(function WorldMap({
  countryCounts,
  continentCounts,
  maxCountryCount,
  maxContinentCount,
  geoView,
  setGeoView,
  geoFilter,
  setGeoFilter,
}: {
  countryCounts: Record<string, number>;
  continentCounts: Record<string, number>;
  maxCountryCount: number;
  maxContinentCount: number;
  geoView: GeoView;
  setGeoView: (v: GeoView) => void;
  geoFilter: GeoFilter;
  setGeoFilter: React.Dispatch<React.SetStateAction<GeoFilter>>;
}) {
  const mapWrapperRef = useRef<HTMLDivElement | null>(null);
  const [geoHover, setGeoHover] = useState<{ label: string; count: number; x: number; y: number } | null>(null);
  const worldMap = world as any;

  const getFillForLocation = useCallback((codeLower: string) => {
    const code = codeLower.toUpperCase();
    const cont = getContinentCode(code);
    if (geoView === "continent") {
      if (!cont) return "#14181c";
      const base = CONTINENT_COLORS[cont] || "#334";
      const intensity = (continentCounts[cont] || 0) / maxContinentCount;
      return mixHex("#14181c", base, Math.min(1, 0.2 + intensity * 0.8));
    }
    const count = countryCounts[code] || 0;
    if (count === 0) return "#14181c";
    const intensity = count / maxCountryCount;
    return mixHex("#14181c", "#00e054", Math.min(1, 0.2 + intensity * 0.8));
  }, [geoView, continentCounts, maxContinentCount, countryCounts, maxCountryCount]);

  const isSelectedLocation = useCallback((codeLower: string) => {
    if (!geoFilter) return false;
    const code = codeLower.toUpperCase();
    if (geoFilter.type === "country") {
      return geoFilter.value.toUpperCase() === code;
    }
    const cont = getContinentCode(code);
    return cont === geoFilter.value;
  }, [geoFilter]);

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
        style={{ position: "relative", width: "100%", backgroundColor: "#14181c", borderRadius: "8px", padding: "8px" }}
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
              color: "#ccd",
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
                      ? { ...prev, x: e.clientX - rect.left, y: e.clientY - rect.top }
                      : { label, count: hoverCount, x: e.clientX - rect.left, y: e.clientY - rect.top }
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
});

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
  primaryInfo?: ReactNode;
  secondaryValue: number;
  secondaryLabel: string;
  size?: number;
  onClick?: () => void;
  isSelected?: boolean;
};

const StatPieChart = ({
  primaryValue,
  primaryLabel,
  primaryInfo,
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
        <span style={{ fontSize: "13px", color: "#9ab" }}>{secondaryLabel}</span>
        <span style={{ fontSize: "13px", color: "#9ab", marginLeft: "4px" }}>{secondaryPercent}%</span>
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
        <span style={{ fontSize: "13px", fontWeight: 500, color: "#ccd" }}>
          {primaryLabel}
        </span>
        {primaryInfo && <span style={{ marginLeft: "6px" }}>{primaryInfo}</span>}
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
const TMDB_PROFILE_BASE = "https://image.tmdb.org/t/p/w185";
const TASTE_DIVERSIFY_NOTES = [
  "Your watched list has a type. It's time to broaden the dating pool.",
  "The data says: go watch something outside your comfort zone.",
  "We ran out of people. The algorithm craves variety.",
  "Your stats are whispering: try new voices.",
  "We can’t compute this taste DNA. It needs more DNA.",
  "No top five yet—your watchlist is playing favorites.",
  "The charts want range. Give them range.",
  "Variety is the spice. Your stats are a little bland.",
  "Not enough data yet. Your future self is begging for a broader watchlist.",
  "We couldn’t fill this one. Your algorithmic destiny demands variety.",
  "This category is empty. The universe says: diversify your movies.",
];

type TastePerson = {
  name: string;
  count: number;
  avgRating: number;
  ratingCount: number;
  profilePath?: string | null;
};

type TasteCountry = {
  code: string;
  name: string;
  count: number;
  avgRating: number;
};

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

  const toLocalDateKey = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

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
      const dateKey = toLocalDateKey(current);
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
  maxCountOverride?: number;
  onHoverCell?: (label: string, dateKey: string, x: number, y: number) => void;
  onLeaveCell?: () => void;
};

const HeatmapYear = memo(({
  year,
  counts,
  compact = false,
  maxCountOverride,
  onHoverCell,
  onLeaveCell,
}: HeatmapYearProps) => {
  const { weeks, monthLabels, maxCount } = useMemo(
    () => buildYearHeatmap(parseInt(year, 10), counts),
    [year, counts]
  );
  const colorMax = typeof maxCountOverride === "number" ? maxCountOverride : maxCount;
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
                  style={{ backgroundColor: cell.inYear ? getHeatColor(cell.count, colorMax) : "#151b20" }}
                  onMouseEnter={(event) => {
                    if (!onHoverCell) return;
                    onHoverCell(formatHeatmapLabel(cell.date, cell.count), cell.dateKey, event.clientX, event.clientY);
                  }}
                  onMouseMove={(event) => {
                    if (!onHoverCell) return;
                    onHoverCell(formatHeatmapLabel(cell.date, cell.count), cell.dateKey, event.clientX, event.clientY);
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
  rating: number | null;
  runtime: number | null;
  directedByWoman: boolean;
  writtenByWoman: boolean;
  byBlackDirector: boolean;
  notAmerican: boolean;
  notEnglish: boolean;
  inCriterion: boolean;
  criteriaCount: number;
};

type DiaryTableProps = {
  moviesWithData: any[];
  blackDirectorIds: Set<number>;
  diaryRatingMap: Map<string, { rating: number; date: string }>;
  diaryFilters: {
    directedByWoman: boolean;
    writtenByWoman: boolean;
    byBlackDirector: boolean;
    notAmerican: boolean;
    notEnglish: boolean;
    inCriterion: boolean;
  };
  diaryFilterMode: "all" | "any";
  setDiaryFilterMode: Dispatch<SetStateAction<"all" | "any">>;
  setDiaryFilters: Dispatch<SetStateAction<{
    directedByWoman: boolean;
    writtenByWoman: boolean;
    byBlackDirector: boolean;
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
  blackDirectorIds,
  diaryRatingMap,
  diaryFilters,
  diaryFilterMode,
  setDiaryFilterMode,
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
      const ratingEntry =
        (movie.letterboxd_url && diaryRatingMap.get(movie.letterboxd_url)) ||
        diaryRatingMap.get(key);
      const rating = ratingEntry ? ratingEntry.rating : null;
      map.set(key, {
        name,
        year,
        uri: movie.letterboxd_url || "",
        director: directorNames || "Unknown",
        rating,
        runtime: typeof tmdbData.runtime === "number" ? tmdbData.runtime : null,
        directedByWoman: tmdbData.directed_by_woman === true,
        writtenByWoman: tmdbData.written_by_woman === true,
        byBlackDirector:
          movie.is_by_black_director === true ||
          (tmdbData?.directors || []).some((d: any) => typeof d?.id === "number" && blackDirectorIds.has(d.id)),
        notAmerican: tmdbData.is_american === false,
        notEnglish: tmdbData.is_english === false,
        inCriterion: movie.is_in_criterion_collection === true,
        criteriaCount: [
          tmdbData.directed_by_woman === true,
          tmdbData.written_by_woman === true,
          movie.is_by_black_director === true,
          tmdbData.is_american === false,
          tmdbData.is_english === false,
          movie.is_in_criterion_collection === true,
        ].filter(Boolean).length,
      });
    }
    return Array.from(map.values());
  }, [moviesWithData, blackDirectorIds, diaryRatingMap]);
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
    const matchesCriteria = (movie: DiaryMovie) => {
      const checks: boolean[] = [];
      if (diaryFilters.directedByWoman) checks.push(movie.directedByWoman);
      if (diaryFilters.writtenByWoman) checks.push(movie.writtenByWoman);
      if (diaryFilters.byBlackDirector) checks.push(movie.byBlackDirector);
      if (diaryFilters.notAmerican) checks.push(movie.notAmerican);
      if (diaryFilters.notEnglish) checks.push(movie.notEnglish);
      if (diaryFilters.inCriterion) checks.push(movie.inCriterion);
      if (checks.length === 0) return true;
      if (diaryFilterMode === "any") return checks.some(Boolean);
      return checks.every(Boolean);
    };
    let filtered = hasActiveFilter
      ? diaryMovieList.filter((movie) => matchesCriteria(movie))
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
  }, [diaryFilters, diaryFilterMode, diaryMovieList, diarySortColumn, diarySortState]);

  const hasActiveFilter = Object.values(diaryFilters).some(Boolean);

  // (removed unused toggleFilter; use toggleFilterPreserveScroll)

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

  const preserveScrollLeft = () => {
    const left = tableScrollRef.current?.scrollLeft || 0;
    requestAnimationFrame(() => {
      if (tableScrollRef.current) {
        tableScrollRef.current.scrollLeft = left;
      }
    });
  };

  const toggleFilterPreserveScroll = (key: keyof typeof diaryFilters) => {
    preserveScrollLeft();
    setDiaryFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  };

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
        <div className="lb-cell lb-cell-center">
          {movie.rating != null ? `★${movie.rating.toFixed(1)}` : "—"}
        </div>
        <div className="lb-cell lb-cell-center">{movie.year}</div>
        <div className="lb-cell lb-cell-flag" style={{ color: movie.directedByWoman ? "#00e054" : "#456" }}>
          {movie.directedByWoman ? "✓" : "✗"}
        </div>
        <div className="lb-cell lb-cell-flag" style={{ color: movie.writtenByWoman ? "#00e054" : "#456" }}>
          {movie.writtenByWoman ? "✓" : "✗"}
        </div>
        <div className="lb-cell lb-cell-flag" style={{ color: movie.byBlackDirector ? "#00e054" : "#456" }}>
          {movie.byBlackDirector ? "✓" : "✗"}
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
          <span className="lb-filter-mode">
            Match:
            <button
              className={`lb-filter-mode-btn ${diaryFilterMode === "all" ? "is-active" : ""}`}
              onClick={() => setDiaryFilterMode("all")}
              type="button"
            >
              All
            </button>
            <button
              className={`lb-filter-mode-btn ${diaryFilterMode === "any" ? "is-active" : ""}`}
              onClick={() => setDiaryFilterMode("any")}
              type="button"
            >
              Any
            </button>
          </span>
          <button
            onClick={() => setDiaryFilters({
              directedByWoman: false,
              writtenByWoman: false,
              byBlackDirector: false,
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
        style={{ ["--lb-table-min-width" as any]: "800px" }}
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
            <button className="lb-header-cell" title="Click to sort by rating" onClick={() => toggleSort("rating")}>
              Rating{getSortIndicator("rating")}
            </button>
            <button className="lb-header-cell" title="Click to sort by year" onClick={() => toggleSort("year")}>
              Year{getSortIndicator("year")}
            </button>
            <button className={`lb-header-cell lb-header-flag ${diaryFilters.directedByWoman ? "lb-header-active" : ""}`} onClick={() => toggleFilterPreserveScroll("directedByWoman")}>
              Dir♀
            </button>
            <button className={`lb-header-cell lb-header-flag ${diaryFilters.writtenByWoman ? "lb-header-active" : ""}`} onClick={() => toggleFilterPreserveScroll("writtenByWoman")}>
              Writ♀
            </button>
            <button className={`lb-header-cell lb-header-flag lb-header-flag-center ${diaryFilters.byBlackDirector ? "lb-header-active" : ""}`} onClick={() => toggleFilterPreserveScroll("byBlackDirector")}>
              Blk Dir
            </button>
            <button className={`lb-header-cell lb-header-flag ${diaryFilters.notAmerican ? "lb-header-active" : ""}`} onClick={() => toggleFilterPreserveScroll("notAmerican")}>
              !US
            </button>
            <button className={`lb-header-cell lb-header-flag ${diaryFilters.notEnglish ? "lb-header-active" : ""}`} onClick={() => toggleFilterPreserveScroll("notEnglish")}>
              !EN
            </button>
            <button className={`lb-header-cell lb-header-flag ${diaryFilters.inCriterion ? "lb-header-active" : ""}`} onClick={() => toggleFilterPreserveScroll("inCriterion")}>
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
                <div className="lb-cell lb-cell-center">
                  {movie.rating != null ? `★${movie.rating.toFixed(1)}` : "—"}
                </div>
                <div className="lb-cell lb-cell-center">{movie.year}</div>
                <div className="lb-cell lb-cell-flag">{movie.directedByWoman ? "✓" : "✗"}</div>
                <div className="lb-cell lb-cell-flag">{movie.writtenByWoman ? "✓" : "✗"}</div>
                <div className="lb-cell lb-cell-flag">{movie.byBlackDirector ? "✓" : "✗"}</div>
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
          minWidth={800}
        />
        <div className="lb-table-key">
          Dir♀ = Directed by women · Writ♀ = Written by women · Blk Dir = Films by Black directors <BlackDirectorsInfo align="center" /> · !US = Non-American · !EN = Not in English · CC = In the Criterion Collection
        </div>
        </div>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Watchlist Builder Component
// ---------------------------------------------------------------------------
type WatchlistBuilderProps = {
  curatedPayload: CuratedListsPayload | null;
  curatedLoading: boolean;
  builderState: WatchlistBuilderState;
  setBuilderState: Dispatch<SetStateAction<WatchlistBuilderState>>;
  builderResults: CuratedFilm[];
  builderRankedCount: number;
  builderRandomCount: number;
  builderRandomSources: string[];
  seenExcludedCount: number;
  hasDiary: boolean;
  watchlistCount: number;
  onShuffle: () => void;
  onRemove: (url: string) => void;
};

const WatchlistBuilder = memo(({
  curatedPayload,
  curatedLoading,
  builderState,
  setBuilderState,
  builderResults,
  builderRankedCount,
  builderRandomCount,
  builderRandomSources,
  seenExcludedCount,
  hasDiary,
  watchlistCount,
  onShuffle,
  onRemove,
}: WatchlistBuilderProps) => {

  const [sourcesOpen, setSourcesOpen] = useState(false);
  const hasBlackDirectorData = useMemo(
    () => curatedPayload?.films?.some((film) => typeof film.is_by_black_director === "boolean") ?? false,
    [curatedPayload]
  );

  const handleChange = useCallback(
    (key: keyof WatchlistBuilderState) => (e: ChangeEvent<HTMLSelectElement>) => {
      const value = key === "count" ? Number(e.target.value) : e.target.value;
      setBuilderState((prev) => ({
        ...prev,
        [key]: value,
        shuffleAllSeed: key === "shuffleAllSeed" ? (value as number | null) : null,
      }));
    },
    [setBuilderState]
  );

  const handleListToggle = useCallback(
    (key: string) => {
      setBuilderState((prev) => {
        const next = new Set(prev.listSources);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        return { ...prev, listSources: Array.from(next) };
      });
    },
    [setBuilderState]
  );

  const handleExport = useCallback(() => {
    const csvRows = builderResults.map((film) => ({
      Date: "",
      Name: film.name,
      Year: film.year ?? "",
      "Letterboxd URI": film.url,
    }));
    const csvText = Papa.unparse(csvRows, {
      columns: ["Date", "Name", "Year", "Letterboxd URI"],
    });
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "watchlist-builder.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [builderResults]);

  const totalMatches = useMemo(() => {
    return builderResults.length;
  }, [builderResults]);

  if (curatedLoading) {
    return (
      <div style={{ textAlign: "center", padding: "32px 0", color: "#9ab" }}>
        Loading curated list data…
      </div>
    );
  }

  if (!curatedPayload) {
    return null;
  }

  const listEntries = Object.entries(curatedPayload.lists || {});
  const selectedSourceCount = builderState.listSources.length || listEntries.length;
  const hasCreatorFilter = builderState.directorWomen || builderState.writerWomen || builderState.directorBlack;

  return (
    <div className="lb-builder">
      {/* Form rows */}
      <div className="lb-builder-form">
        <div className="lb-builder-row-form">
          <span className="lb-builder-label">Show me</span>
          <select className="lb-builder-select" value={builderState.count} onChange={handleChange("count")}>
            <option value={10}>10 films</option>
            <option value={25}>25 films</option>
            <option value={50}>50 films</option>
            <option value={100}>100 films</option>
          </select>
        </div>

        <div className="lb-builder-row-form">
          <span className="lb-builder-label">Ranked by</span>
          <select className="lb-builder-select" value={builderState.quality} onChange={handleChange("quality")}>
            <option value="any">Consensus across lists</option>
            <option value="critically-acclaimed">Most lists appeared on</option>
            <option value="highest-rated">Highest TMDb rating</option>
            <option value="imdb-popularity">Mainstream popularity (IMDb Top 250)</option>
          </select>
        </div>

        <div className="lb-builder-row-form">
          <span className="lb-builder-label">Made by</span>
          <div className="lb-builder-director-controls">
            <label className={`lb-builder-chip ${builderState.directorWomen ? "active" : ""}`}>
              <input
                type="checkbox"
                checked={builderState.directorWomen}
                onChange={(e) => setBuilderState((prev) => ({ ...prev, directorWomen: e.target.checked }))}
              />
              Women directors
            </label>
            <label className={`lb-builder-chip ${builderState.writerWomen ? "active" : ""}`}>
              <input
                type="checkbox"
                checked={builderState.writerWomen}
                onChange={(e) => setBuilderState((prev) => ({ ...prev, writerWomen: e.target.checked }))}
              />
              Women writers
            </label>
            <label className={`lb-builder-chip ${builderState.directorBlack ? "active" : ""}`}>
              <input
                type="checkbox"
                checked={builderState.directorBlack}
                onChange={(e) => setBuilderState((prev) => ({ ...prev, directorBlack: e.target.checked, shuffleAllSeed: null }))}
                disabled={!hasBlackDirectorData}
              />
              Black directors{!hasBlackDirectorData ? " (unavailable)" : ""}
            </label>
            <BlackDirectorsInfo align="center" />
            {hasCreatorFilter && (
              <select
                className="lb-builder-select lb-builder-select-mini"
                value={builderState.directorMode}
                onChange={handleChange("directorMode")}
              >
                <option value="any">match any</option>
                <option value="all">match all</option>
              </select>
            )}
            {!hasCreatorFilter && (
              <span className="lb-builder-hint">Anyone — tap to filter</span>
            )}
          </div>
        </div>

        <div className="lb-builder-row-form">
          <span className="lb-builder-label">From</span>
          <select className="lb-builder-select" value={builderState.origin} onChange={handleChange("origin")}>
            <option value="anywhere">Anywhere</option>
            <option value="not-usa">Anywhere except USA</option>
            <option value="non-english">Non-English speaking</option>
            <option value="africa">Africa</option>
            <option value="asia">Asia</option>
            <option value="europe">Europe</option>
            <option value="latin-america">Latin America</option>
            <option value="middle-east">Middle East</option>
            <option value="oceania">Oceania</option>
          </select>
        </div>

        <div className="lb-builder-row-form">
          <span className="lb-builder-label">That I</span>
          <select className="lb-builder-select" value={builderState.seen} onChange={handleChange("seen")}>
            <option value="havent-seen">Haven&apos;t seen yet</option>
            <option value="have-seen">Have seen</option>
            <option value="any">May or may not have seen</option>
          </select>
          {!hasDiary && builderState.seen !== "any" && (
            <span className="lb-builder-diary-hint">Upload diary to filter</span>
          )}
        </div>

        {watchlistCount > 0 && (
          <div className="lb-builder-row-form">
            <span className="lb-builder-label">Watchlist</span>
            <select className="lb-builder-select" value={builderState.watchlistBias} onChange={handleChange("watchlistBias")}>
              <option value="any">Surprise me</option>
              <option value="prefer">Prioritize my watchlist</option>
              <option value="exclude">Exclude my watchlist</option>
            </select>
          </div>
        )}
      </div>

      {/* Source lists (Idea B) */}
      <div className="lb-builder-row-form lb-builder-source-row">
        <span className="lb-builder-label">From</span>
        <div className="lb-builder-source-summary">
          <span className="lb-builder-source-count">{selectedSourceCount} acclaimed lists</span>
          <button
            type="button"
            className="lb-builder-source-edit"
            onClick={() => setSourcesOpen((v) => !v)}
          >
            {sourcesOpen ? "Hide" : "Edit"}
          </button>
          <span className={`lb-builder-sources-arrow ${sourcesOpen ? "open" : ""}`}>{sourcesOpen ? "\u25BE" : "\u25B8"}</span>
          <select
            className="lb-builder-select lb-builder-select-mini"
            value={builderState.listMode}
            onChange={handleChange("listMode")}
          >
            <option value="any">match any</option>
            <option value="all">match all</option>
          </select>
        </div>
      </div>
      {sourcesOpen && (
        <div className="lb-builder-sources-grid">
          {listEntries.map(([key, meta]) => (
            <label
              key={key}
              className={`lb-builder-chip lb-builder-chip-source ${builderState.listSources.includes(key) || !builderState.listSources.length ? "active" : ""}`}
            >
              <input
                type="checkbox"
                checked={builderState.listSources.includes(key) || !builderState.listSources.length}
                onChange={() => {
                  if (!builderState.listSources.length) {
                    setBuilderState((prev) => ({ ...prev, listSources: [key] }));
                  } else {
                    handleListToggle(key);
                  }
                }}
              />
              {meta.name}
              {meta.ranked && <span className="lb-builder-ranked-icon">🏆</span>}
            </label>
          ))}
          <div className="lb-builder-sources-key">
            <span className="lb-builder-ranked-icon">🏆</span> position matters · others are unranked collections
          </div>
        </div>
      )}

      {/* Match count divider */}
      <div className="lb-builder-divider">
        <span className="lb-builder-divider-line" />
        <span className="lb-builder-count">
          {totalMatches} film{totalMatches !== 1 ? "s" : ""} match
          {seenExcludedCount > 0 && (
            <span className="lb-builder-excluded"> · {seenExcludedCount} excluded as watched</span>
          )}
        </span>
        <span className="lb-builder-divider-line" />
      </div>

      {/* Sorting/shuffle info */}
      {(builderRankedCount > 0 || builderRandomCount > 0) && (
        <div className="lb-builder-meta">
          <span>
            {builderRankedCount > 0 && <>{builderRankedCount} ranked by consensus</>}
            {builderRankedCount > 0 && builderRandomCount > 0 && " · "}
            {builderRandomCount > 0 && <>{builderRandomCount} randomly selected</>}
          </span>
          {builderRandomCount > 0 && builderRandomSources.length > 0 && (
            <span className="lb-builder-meta-sub">
              from {builderRandomSources.join(", ")}
            </span>
          )}
        </div>
      )}
      {builderResults.length > 1 && (
        <div className="lb-builder-shuffle-row">
          <button type="button" className="lb-builder-shuffle-btn" onClick={onShuffle}>
            Shuffle
          </button>
        </div>
      )}

      {/* Preview table */}
      {builderResults.length > 0 && (
        <div className="lb-builder-preview">
          <div className="lb-builder-table-head">
            <span>#</span>
            <span>Title</span>
            <span>Year</span>
            <span>Director</span>
            <span>TMDb rating</span>
            <span></span>
          </div>
          {builderResults.map((film, idx) => (
            <div className="lb-builder-table-row" key={`${film.url}-${idx}`}>
              <span className="lb-builder-cell-num">{idx + 1}</span>
              <span>
                <a href={film.url} target="_blank" rel="noopener noreferrer" className="lb-builder-film-link">
                  {film.name}
                </a>
              </span>
              <span className="lb-builder-cell-muted">{film.year}</span>
              <span className="lb-builder-cell-muted">
                {(film.tmdb_data?.directors || []).map((d: any) => d.name).join(", ") || "—"}
              </span>
              <span className="lb-builder-cell-rating">
                {film.tmdb_data?.vote_average ? film.tmdb_data.vote_average.toFixed(1) : "—"}
              </span>
              <button type="button" className="lb-builder-remove" onClick={() => onRemove(film.url)}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Export button */}
      {builderResults.length > 0 && (
        <div className="lb-builder-export-row">
          <button className="lb-builder-export" onClick={handleExport}>
            Export as Letterboxd CSV
          </button>
        </div>
      )}
    </div>
  );
});

type WatchlistTableProps = {
  watchlistMovies: WatchlistMovie[];
  watchlistPaceText?: ReactNode | null;
  watchlistFilters: {
    directedByWoman: boolean;
    writtenByWoman: boolean;
    byBlackDirector: boolean;
    notAmerican: boolean;
    notEnglish: boolean;
    inCriterion: boolean;
  };
  watchlistFilterMode: "all" | "any";
  setWatchlistFilterMode: Dispatch<SetStateAction<"all" | "any">>;
  setWatchlistFilters: Dispatch<SetStateAction<{
    directedByWoman: boolean;
    writtenByWoman: boolean;
    byBlackDirector: boolean;
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
  watchlistPaceText,
  watchlistFilters,
  watchlistFilterMode,
  setWatchlistFilterMode,
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
    const matchesCriteria = (movie: WatchlistMovie) => {
      const checks: boolean[] = [];
      if (watchlistFilters.directedByWoman) checks.push(movie.directedByWoman);
      if (watchlistFilters.writtenByWoman) checks.push(movie.writtenByWoman);
      if (watchlistFilters.byBlackDirector) checks.push(movie.byBlackDirector);
      if (watchlistFilters.notAmerican) checks.push(movie.notAmerican);
      if (watchlistFilters.notEnglish) checks.push(movie.notEnglish);
      if (watchlistFilters.inCriterion) checks.push(movie.inCriterion);
      if (checks.length === 0) return true;
      if (watchlistFilterMode === "any") return checks.some(Boolean);
      return checks.every(Boolean);
    };
    let filtered = watchlistMovies.filter((movie) => {
      if (hasActiveFilter && !matchesCriteria(movie)) return false;
      if (hasActiveContinentFilter && watchlistContinentFilter && !movie.continents.includes(watchlistContinentFilter)) {
        return false;
      }
      if (!passesRuntimeFilter(movie.runtime)) return false;
      return true;
    });

    filtered = sortMoviesByColumn(filtered, watchlistSortColumn, watchlistSortState);
    return filtered;
  }, [
    passesRuntimeFilter,
    watchlistContinentFilter,
    watchlistFilters,
    watchlistFilterMode,
    watchlistMovies,
    watchlistSortColumn,
    watchlistSortState,
  ]);

  const hasActiveFilter = Object.values(watchlistFilters).some(Boolean);
  const hasActiveRuntimeFilter = watchlistRuntimeFilter !== "all";
  const hasActiveContinentFilter = watchlistContinentFilter !== null;
  const hasAnyFilter = hasActiveFilter || hasActiveRuntimeFilter || hasActiveContinentFilter;

  // (removed unused toggleFilter; use toggleWatchlistFilterPreserveScroll)

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

  const preserveWatchlistScrollLeft = () => {
    const left = tableScrollRef.current?.scrollLeft || 0;
    requestAnimationFrame(() => {
      if (tableScrollRef.current) {
        tableScrollRef.current.scrollLeft = left;
      }
    });
  };

  const toggleWatchlistFilterPreserveScroll = (key: keyof typeof watchlistFilters) => {
    preserveWatchlistScrollLeft();
    setWatchlistFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  };

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
        <div className="lb-cell lb-cell-flag" style={{ color: movie.byBlackDirector ? "#00e054" : "#456" }}>
          {movie.byBlackDirector ? "✓" : "✗"}
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
          {Object.values(watchlistFilters).some(Boolean) && (
            <span className="lb-filter-mode">
              Match:
              <button
                className={`lb-filter-mode-btn ${watchlistFilterMode === "all" ? "is-active" : ""}`}
                onClick={() => setWatchlistFilterMode("all")}
                type="button"
              >
                All
              </button>
              <button
                className={`lb-filter-mode-btn ${watchlistFilterMode === "any" ? "is-active" : ""}`}
                onClick={() => setWatchlistFilterMode("any")}
                type="button"
              >
                Any
              </button>
            </span>
          )}
          <button
            onClick={() => {
              setWatchlistFilters({
                directedByWoman: false,
                writtenByWoman: false,
                byBlackDirector: false,
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
        style={{ ["--lb-table-min-width" as any]: "880px" }}
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
            <button className={`lb-header-cell lb-header-flag ${watchlistFilters.directedByWoman ? "lb-header-active" : ""}`} onClick={() => toggleWatchlistFilterPreserveScroll("directedByWoman")}>
              Dir♀
            </button>
            <button className={`lb-header-cell lb-header-flag ${watchlistFilters.writtenByWoman ? "lb-header-active" : ""}`} onClick={() => toggleWatchlistFilterPreserveScroll("writtenByWoman")}>
              Writ♀
            </button>
            <button className={`lb-header-cell lb-header-flag lb-header-flag-center ${watchlistFilters.byBlackDirector ? "lb-header-active" : ""}`} onClick={() => toggleWatchlistFilterPreserveScroll("byBlackDirector")}>
              Blk Dir
            </button>
            <button className={`lb-header-cell lb-header-flag ${watchlistFilters.notAmerican ? "lb-header-active" : ""}`} onClick={() => toggleWatchlistFilterPreserveScroll("notAmerican")}>
              !US
            </button>
            <button className={`lb-header-cell lb-header-flag ${watchlistFilters.notEnglish ? "lb-header-active" : ""}`} onClick={() => toggleWatchlistFilterPreserveScroll("notEnglish")}>
              !EN
            </button>
            <button className={`lb-header-cell lb-header-flag ${watchlistFilters.inCriterion ? "lb-header-active" : ""}`} onClick={() => toggleWatchlistFilterPreserveScroll("inCriterion")}>
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
                <div className="lb-cell lb-cell-flag">{movie.byBlackDirector ? "✓" : "✗"}</div>
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
          minWidth={880}
        />
        <div className="lb-table-key">
          Dir♀ = Directed by women · Writ♀ = Written by women · Blk Dir = Films by Black directors <BlackDirectorsInfo align="center" /> · !US = Non-American · !EN = Not in English · CC = In the Criterion Collection
        </div>
        </div>
      </div>
      {watchlistPaceText && (
        <div className="lb-watchlist-pace">{watchlistPaceText}</div>
      )}
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
    byBlackDirector: boolean;
    notAmerican: boolean;
    notEnglish: boolean;
    inCriterion: boolean;
  }>({
    directedByWoman: false,
    writtenByWoman: false,
    byBlackDirector: false,
    notAmerican: false,
    notEnglish: false,
    inCriterion: false,
  });
  const [watchlistFilterMode, setWatchlistFilterMode] = useState<"all" | "any">("all");
  const [watchlistSortColumn, setWatchlistSortColumn] = useState<WatchlistSortColumn>(null);
  const [watchlistSortState, setWatchlistSortState] = useState<WatchlistSortState>("default");
  const [watchlistRuntimeFilter, setWatchlistRuntimeFilter] = useState<RuntimeFilter>("all");
  const [watchlistContinentFilter, setWatchlistContinentFilter] = useState<string | null>(null);
  const [reviewLovedExpanded, setReviewLovedExpanded] = useState<boolean>(false);
  const [reviewHatedExpanded, setReviewHatedExpanded] = useState<boolean>(false);
  const [tasteSortMode, setTasteSortMode] = useState<"rated" | "watched">("rated");
  const [tasteCategory, setTasteCategory] = useState<string>("womenDirectors");
  const [tasteExpandedPerson, setTasteExpandedPerson] = useState<string | null>(null);
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
  const [isRssPreview, setIsRssPreview] = useState<boolean>(false);
  const [rssUsername, setRssUsername] = useState<string>("");
  const [rssLoading, setRssLoading] = useState<boolean>(false);
  const [rssError, setRssError] = useState<string | null>(null);
  const [manualUploadOpen, setManualUploadOpen] = useState<boolean>(false);
  const [pendingUploadTarget, setPendingUploadTarget] = useState<"diary" | "reviews" | "watchlist" | null>(null);
  const builderToggleGuard = useRef<number>(0);

  // Watchlist Builder state
  const [curatedPayload, setCuratedPayload] = useState<CuratedListsPayload | null>(null);
  const [curatedLoading, setCuratedLoading] = useState<boolean>(false);
  const [builderExpanded, setBuilderExpanded] = useState<boolean>(false);
  const [builderExcluded, setBuilderExcluded] = useState<string[]>([]);
  const [builderState, setBuilderState] = useState<WatchlistBuilderState>({
    count: 50,
    quality: "any",
    directorMode: "any",
    directorWomen: false,
    directorBlack: false,
    writerWomen: false,
    listMode: "any",
    listSources: [],
    shuffleSeed: Date.now(),
    shuffleAllSeed: null,
    origin: "anywhere",
    seen: "havent-seen",
    watchlistBias: "any",
  });

  // Diary table state (for Film Breakdown section)
  const [diaryFilters, setDiaryFilters] = useState<{
    directedByWoman: boolean;
    writtenByWoman: boolean;
    byBlackDirector: boolean;
    notAmerican: boolean;
    notEnglish: boolean;
    inCriterion: boolean;
  }>({
    directedByWoman: false,
    writtenByWoman: false,
    byBlackDirector: false,
    notAmerican: false,
    notEnglish: false,
    inCriterion: false,
  });
  const [diaryFilterMode, setDiaryFilterMode] = useState<"all" | "any">("all");
  const [diarySortColumn, setDiarySortColumn] = useState<WatchlistSortColumn>(null);
  const [diarySortState, setDiarySortState] = useState<WatchlistSortState>("default");
  const [decadeHover, setDecadeHover] = useState<{ label: string; count: number; percent: number; midPercent: number } | null>(null);
  const [offsetDecadeHover, setOffsetDecadeHover] = useState<{ label: string; count: number; percent: number; midPercent: number } | null>(null);
  const [ratingFilter, setRatingFilter] = useState<string | null>(null);
  const [decadeFilter, setDecadeFilter] = useState<DecadeFilter>(null);
  const [geoFilter, setGeoFilter] = useState<GeoFilter>(null);
  const [geoView, setGeoView] = useState<GeoView>("continent");
  const heatmapScrollRef = useRef<HTMLDivElement | null>(null);
  const [heatmapTooltip, setHeatmapTooltip] = useState<{ text: string; x: number; y: number; align: "left" | "center" | "right"; movies: Array<{ name: string; year: string }> } | null>(null);
  const diaryInputRef = useRef<HTMLInputElement | null>(null);

  const toggleDiaryFilter = useCallback((key: keyof typeof diaryFilters) => {
    setDiaryFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);
  const reviewsInputRef = useRef<HTMLInputElement | null>(null);
  const watchlistInputRef = useRef<HTMLInputElement | null>(null);
  const diarySectionRef = useRef<HTMLDivElement | null>(null);
  const reviewsSectionRef = useRef<HTMLDivElement | null>(null);
  const watchlistSectionRef = useRef<HTMLDivElement | null>(null);

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

  const processDiaryFile = (file: File, options?: { fromRss?: boolean }) => {
    setRatingFilter(null);
    setDecadeFilter(null);
    setGeoFilter(null);
    setDateFilter("all");
    setIsDiaryFormat(true);
    setIsRssPreview(Boolean(options?.fromRss));
    setRssError(null);
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
    setIsRssPreview(false);
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

      const blackDirectorIdsForWatchlist = new Set<number>();
      for (const movie of Object.values(index as Record<string, any>)) {
        if (!movie?.is_by_black_director) continue;
        const directors = movie?.tmdb_data?.directors || [];
        for (const director of directors) {
          if (typeof director?.id === "number") blackDirectorIdsForWatchlist.add(director.id);
        }
      }

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
        const byBlackDirector = movie?.is_by_black_director === true;
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

        const directorIds = (tmdbData?.directors || []).map((d: any) => d?.id).filter((id: any) => typeof id === "number");
        const byBlackDirectorResolved =
          byBlackDirector || directorIds.some((id: number) => blackDirectorIdsForWatchlist.has(id));

        const criteriaCount = [directedByWoman, writtenByWoman, byBlackDirectorResolved, notAmerican, notEnglish, inCriterion]
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
            byBlackDirector: byBlackDirectorResolved,
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

  const coerceRssDate = (value: string) => {
    if (!value) return "";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toISOString().slice(0, 10);
  };

  const fetchRssPreview = async () => {
    const rawUsername = rssUsername.trim().replace(/^@/, "");
    const normalizedUsername = rawUsername.replace(/^https?:\/\/letterboxd\.com\/+/i, "").split("/")[0];
    const username = normalizedUsername.trim();
    if (!username) {
      setRssError("Enter a Letterboxd username.");
      return;
    }

    setError(null);
    setRssError(null);
    setRssLoading(true);

    try {
      const isLocalHost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
      const useRemoteApi = isLocalHost && diaryUseVercelApi;
      const baseUrl = useRemoteApi ? "https://letterbddy.vercel.app" : isLocalHost ? "http://localhost:5050" : "";

      const res = await fetch(`${baseUrl}/api/rss?username=${encodeURIComponent(username)}`);
      const rawText = await res.text();
      const contentType = res.headers.get("content-type") || "";
      let data: any = null;
      if (!contentType.includes("application/json")) {
        const hint = useRemoteApi
          ? "The Vercel API may not be deployed yet. Try unchecking “Use Vercel API for diary.”"
          : "Check that the local server is running (`npm run server`).";
        throw new Error(`RSS endpoint returned ${res.status} ${res.statusText}. Expected JSON. ${hint}`);
      }
      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        throw new Error("RSS response was not valid JSON.");
      }
      if (!res.ok) {
        const apiError = typeof data?.error === "string" ? data.error : rawText;
        throw new Error(apiError || `RSS error (${res.status})`);
      }
      const entries: RssEntry[] = Array.isArray(data?.entries) ? data.entries : [];
      if (!entries.length) {
        throw new Error("No recent diary entries found for that username.");
      }

      const rowsFromRss: DiaryRow[] = entries
        .map((entry) => {
          const watchedDate = coerceRssDate(entry.watchedDate || entry.pubDate);
          return {
            Date: watchedDate,
            Name: entry.title || "",
            Year: entry.year || "",
            "Letterboxd URI": entry.link || "",
            Rating: entry.rating || "",
            Rewatch: entry.rewatch || "",
            Tags: "",
            "Watched Date": watchedDate,
          };
        })
        .filter((row) => row.Name);

      if (!rowsFromRss.length) {
        throw new Error("No usable diary entries found in the RSS feed.");
      }

      const csvText = (Papa as typeof Papa & { unparse: (data: any, config?: any) => string }).unparse(
        rowsFromRss,
        {
          columns: ["Date", "Name", "Year", "Letterboxd URI", "Rating", "Rewatch", "Tags", "Watched Date"],
        }
      );
      const file = new File([csvText], `${username}-rss.csv`, { type: "text/csv" });
      setDiaryFileName(`${username} (RSS last 50)`);
      processDiaryFile(file, { fromRss: true });
    } catch (err: any) {
      const message = err?.message || "Failed to load RSS feed.";
      setRssError(message.includes("expected pattern") ? "RSS fetch failed. Double-check the username and try again." : message);
    } finally {
      setRssLoading(false);
    }
  };

  const isLocalDev =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

  const blackDirectorIds = useMemo(() => {
    const ids = new Set<number>();
    if (!movieIndex) return ids;
    for (const movie of Object.values(movieIndex)) {
      if (!movie?.is_by_black_director) continue;
      const directors = movie?.tmdb_data?.directors || [];
      for (const director of directors) {
        if (typeof director?.id === "number") ids.add(director.id);
      }
    }
    return ids;
  }, [movieIndex]);

  // Extract unique years from diary entries, sorted descending (newest first)
  function getWatchedDate(row: DiaryRow) {
    return (row["Watched Date"] || (row as any).Date || "").trim();
  }

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

  const diaryLoaded = rows.length > 0;
  const watchlistLoaded = watchlistMovies.length > 0;
  const reviewsLoaded = reviews.length > 0;
  const isAnyLoading = isLoading || isWatchlistLoading;

  // Clear pendingUploadTarget once the targeted upload completes
  useEffect(() => {
    if (isAnyLoading) return;
    if (pendingUploadTarget) {
      const targetDone =
        (pendingUploadTarget === "diary" && diaryLoaded) ||
        (pendingUploadTarget === "reviews" && reviewsLoaded) ||
        (pendingUploadTarget === "watchlist" && watchlistLoaded);
      if (targetDone) {
        setPendingUploadTarget(null);
      }
    }
  }, [isAnyLoading, pendingUploadTarget, diaryLoaded, watchlistLoaded, reviewsLoaded]);

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

  useEffect(() => {
    setTasteExpandedPerson(null);
  }, [tasteCategory]);

  useEffect(() => {
    if (tasteSortMode === "watched" && tasteCategory === "badHabit") {
      setTasteCategory("womenDirectors");
    }
  }, [tasteSortMode, tasteCategory]);


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

  const diaryRatingMap = useMemo(() => {
    const map = new Map<string, { rating: number; date: string }>();
    for (const row of filteredRows) {
      const rawRating = parseFloat(row.Rating);
      if (Number.isNaN(rawRating)) continue;
      const date = getWatchedDate(row) || "";
      const name = (row.Name || "").trim();
      const year = (row.Year || "").trim();
      const keyByName = name ? `${name.toLowerCase()}|${year}` : "";
      const uriRaw = (row["Letterboxd URI"] || "").trim();
      const canon = uriRaw ? canonicalizeUri(uriRaw) : "";

      const update = (key: string) => {
        if (!key) return;
        const prev = map.get(key);
        if (!prev || (date && date >= prev.date)) {
          map.set(key, { rating: rawRating, date });
        }
      };

      update(canon || uriRaw);
      update(uriRaw);
      update(keyByName);
    }
    return map;
  }, [filteredRows, canonicalizeUri]);
  
  // Create sets of both original and canonicalized URIs for matching
  const canonicalizedFilteredUris = useMemo(
    () => new Set(Array.from(filteredUris).map(canonicalizeUri)),
    [filteredUris, canonicalizeUri]
  );

  // Lazy-load curated list data when builder is expanded
  useEffect(() => {
    if (!builderExpanded || curatedPayload || curatedLoading) return;
    setCuratedLoading(true);
    fetch("/curated-lists-enriched.json")
      .then((r) => {
        if (!r.ok) throw new Error("missing enriched lists");
        return r.json();
      })
      .then((data: CuratedListsPayload) => {
        setCuratedPayload(data);
        setCuratedLoading(false);
      })
      .catch(() => {
        fetch("/curated-lists.json")
          .then((r) => r.json())
          .then((data: CuratedListsPayload) => {
            setCuratedPayload(data);
            setCuratedLoading(false);
          })
          .catch(() => setCuratedLoading(false));
      });
  }, [builderExpanded, curatedPayload, curatedLoading]);

  // Set of diary slugs for "haven't seen" / "have seen" filtering (all-time)
  const diarySlugs = useMemo(() => {
    const slugs = new Set<string>();
    for (const row of rows) {
      const raw = (row["Letterboxd URI"] || "").trim();
      if (!raw) continue;
      const canon = canonicalizeUri(raw);
      const candidates = [raw, canon].filter(Boolean);
      for (const uri of candidates) {
        const m = uri.match(/\/film\/([^/]+)/);
        if (m) slugs.add(m[1]);
      }
    }
    return slugs;
  }, [rows, canonicalizeUri]);

  const diaryTitleYears = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      const name = (row.Name || "").trim().toLowerCase();
      if (!name) continue;
      const year = (row.Year || "").trim();
      set.add(`${name}|${year}`);
    }
    return set;
  }, [rows]);

  const watchlistSlugs = useMemo(() => {
    const slugs = new Set<string>();
    for (const movie of watchlistMovies) {
      const raw = (movie.uri || "").trim();
      if (!raw) continue;
      const canon = canonicalizeUri(raw);
      const candidates = [raw, canon].filter(Boolean);
      for (const uri of candidates) {
        const m = uri.match(/\/film\/([^/]+)/);
        if (m) slugs.add(m[1]);
      }
    }
    return slugs;
  }, [watchlistMovies, canonicalizeUri]);

  const watchlistTitleYears = useMemo(() => {
    const set = new Set<string>();
    for (const movie of watchlistMovies) {
      const name = (movie.name || "").trim().toLowerCase();
      if (!name) continue;
      const year = (movie.year || "").trim();
      set.add(`${name}|${year}`);
    }
    return set;
  }, [watchlistMovies]);

  // Map origin codes to continent codes for geographic filtering
  const ORIGIN_CONTINENT_MAP: Record<string, string[]> = useMemo(() => ({
    "africa": ["AF"],
    "asia": ["AS"],
    "europe": ["EU"],
    "latin-america": ["SA"],
    "oceania": ["OC"],
    "middle-east": ["AS"], // Middle East countries are in Asia continent
  }), []);

  // Middle East country codes for more precise filtering
  const MIDDLE_EAST_COUNTRIES = useMemo(() => new Set([
    "AE", "BH", "CY", "EG", "IL", "IQ", "IR", "JO", "KW", "LB",
    "OM", "PS", "QA", "SA", "SY", "TR", "YE",
  ]), []);

  // Latin America country codes
  const LATIN_AMERICA_COUNTRIES = useMemo(() => new Set([
    "AR", "BO", "BR", "CL", "CO", "CR", "CU", "DO", "EC", "SV",
    "GT", "HN", "MX", "NI", "PA", "PY", "PE", "PR", "UY", "VE",
  ]), []);

  // Builder filtering logic
  const builderOutput = useMemo(() => {
    if (!curatedPayload) {
      return { results: [] as CuratedFilm[], rankedCount: 0, randomCount: 0, randomSources: [] as string[], seenExcludedCount: 0 };
    }
    const {
      quality,
      directorMode,
      directorWomen,
      directorBlack,
      writerWomen,
      origin,
      seen,
      count,
      listMode,
      listSources,
      shuffleSeed,
      shuffleAllSeed,
      watchlistBias,
    } = builderState;
    const hasDiary = filteredUris.size > 0;
    const listMeta = curatedPayload.lists || {};

    const selectedLists = listSources.length ? listSources : Object.keys(listMeta);
    const selectedSet = new Set(selectedLists);
    const rankedLists = selectedLists.filter((key) => listMeta[key]?.ranked);
    const unrankedLists = selectedLists.filter((key) => !listMeta[key]?.ranked);

    const getSlug = (url: string) => {
      const match = url.match(/\/film\/([^/]+)/);
      return match ? match[1] : "";
    };

    const excluded = new Set(builderExcluded);
    const filtered = curatedPayload.films.filter((film) => {
      if (excluded.has(film.url)) return false;
      const tmdb = film.tmdb_data || {};
      const filmLists = film.lists ? Object.keys(film.lists) : [];

      if (listSources.length) {
        if (listMode === "any") {
          if (!filmLists.some((key) => selectedSet.has(key))) return false;
        } else {
          if (!selectedLists.every((key) => filmLists.includes(key))) return false;
        }
      }

      const creatorChecks: boolean[] = [];
      if (directorWomen) creatorChecks.push(tmdb.directed_by_woman === true);
      if (writerWomen) creatorChecks.push(tmdb.written_by_woman === true);
      if (directorBlack) creatorChecks.push(film.is_by_black_director === true);
      if (creatorChecks.length > 0) {
        if (directorMode === "any") {
          if (!creatorChecks.some(Boolean)) return false;
        } else {
          if (!creatorChecks.every(Boolean)) return false;
        }
      }

      const countries = tmdb.production_countries?.codes || [];
      if (origin === "not-usa" && tmdb.is_american) return false;
      if (origin === "non-english" && tmdb.is_english) return false;
      if (origin === "africa" || origin === "asia" || origin === "europe" || origin === "oceania") {
        const targetContinents = ORIGIN_CONTINENT_MAP[origin] || [];
        const filmContinents = countries.map((c: string) => getContinentCode(c)).filter(Boolean);
        if (!filmContinents.some((c: any) => targetContinents.includes(c))) return false;
      }
      if (origin === "latin-america") {
        if (!countries.some((c: string) => LATIN_AMERICA_COUNTRIES.has(c))) return false;
      }
      if (origin === "middle-east") {
        if (!countries.some((c: string) => MIDDLE_EAST_COUNTRIES.has(c))) return false;
      }

      const watchlistMatch =
        (getSlug(film.url) && watchlistSlugs.has(getSlug(film.url))) ||
        (`${String(film.name || "").trim().toLowerCase()}|${String(film.year || "").trim()}` && watchlistTitleYears.has(`${String(film.name || "").trim().toLowerCase()}|${String(film.year || "").trim()}`));
      if (watchlistBias === "exclude" && watchlistMatch) return false;

      return true;
    });

    // Count how many pass all filters except the seen filter, then apply seen filter
    let seenExcludedCount = 0;
    const afterSeen = filtered.filter((film) => {
      const slug = getSlug(film.url);
      const titleYearKey = `${String(film.name || "").trim().toLowerCase()}|${String(film.year || "").trim()}`;
      const titleOnlyKey = `${String(film.name || "").trim().toLowerCase()}|`;
      const seenMatch =
        (slug && diarySlugs.has(slug)) ||
        (titleYearKey && diaryTitleYears.has(titleYearKey)) ||
        (titleOnlyKey && diaryTitleYears.has(titleOnlyKey));
      if (hasDiary && seen === "havent-seen" && seenMatch) { seenExcludedCount++; return false; }
      if (hasDiary && seen === "have-seen" && !seenMatch) { seenExcludedCount++; return false; }
      return true;
    });

    if (quality === "highest-rated") {
      const sorted = afterSeen
        .filter((film) => (film.tmdb_data?.vote_average || 0) > 0)
        .sort((a, b) => {
          const aRating = a.tmdb_data?.vote_average || 0;
          const bRating = b.tmdb_data?.vote_average || 0;
          if (bRating !== aRating) return bRating - aRating;
          if (b.listCount !== a.listCount) return b.listCount - a.listCount;
          return a.name.localeCompare(b.name);
        })
        .slice(0, count);
      let results = sorted;
      if (watchlistBias === "prefer") {
        results = [...results].sort((a, b) => {
          const aSlug = getSlug(a.url);
          const bSlug = getSlug(b.url);
          const aMatch = (aSlug && watchlistSlugs.has(aSlug)) || watchlistTitleYears.has(`${a.name.toLowerCase()}|${a.year ?? ""}`);
          const bMatch = (bSlug && watchlistSlugs.has(bSlug)) || watchlistTitleYears.has(`${b.name.toLowerCase()}|${b.year ?? ""}`);
          return Number(bMatch) - Number(aMatch);
        });
      }
      return { results, rankedCount: results.length, randomCount: 0, randomSources: [], seenExcludedCount };
    }

    const withRankInfo = afterSeen.map((film) => {
      const listKeys = film.lists ? Object.keys(film.lists) : [];
      const rankedPositions = listKeys
        .filter((key) => rankedLists.includes(key))
        .map((key) => film.lists[key])
        .filter((value) => typeof value === "number");
      const avgRank = rankedPositions.length
        ? rankedPositions.reduce((sum, v) => sum + v, 0) / rankedPositions.length
        : Number.POSITIVE_INFINITY;
      const hasRanked = rankedPositions.length > 0;
      return { film, avgRank, hasRanked };
    });

    const rankedBucket = withRankInfo.filter((entry) => entry.hasRanked);
    const unrankedBucket = withRankInfo.filter((entry) => !entry.hasRanked);

    rankedBucket.sort((a, b) => {
      if (b.film.listCount !== a.film.listCount) return b.film.listCount - a.film.listCount;
      if (a.avgRank !== b.avgRank) return a.avgRank - b.avgRank;
      return a.film.name.localeCompare(b.film.name);
    });

    const shuffle = (items: typeof unrankedBucket) => {
      const rng = (seed: number) => () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };
      const rand = rng(shuffleSeed);
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    };
    const shuffleResults = (items: CuratedFilm[], seed: number) => {
      const rng = (s: number) => () => {
        s = (s * 9301 + 49297) % 233280;
        return s / 233280;
      };
      const rand = rng(seed);
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    };

    let results: CuratedFilm[] = [];
    let rankedCount = 0;
    let randomCount = 0;
    const randomSources = unrankedLists.map((key) => listMeta[key]?.name || key);

    if (rankedLists.length === 0) {
      const shuffled = shuffle(unrankedBucket).map((entry) => entry.film);
      results = shuffled.slice(0, count);
      randomCount = results.length;
    } else {
      const rankedFilms = rankedBucket.map((entry) => entry.film);
      results = rankedFilms.slice(0, count);
      rankedCount = results.length;
      if (results.length < count && unrankedBucket.length > 0) {
        const shuffled = shuffle(unrankedBucket).map((entry) => entry.film);
        const needed = count - results.length;
        const randomPick = shuffled.slice(0, needed);
        results = results.concat(randomPick);
        randomCount = randomPick.length;
      }
    }

    if (quality === "critically-acclaimed") {
      results = results.sort((a, b) => {
        if (b.listCount !== a.listCount) return b.listCount - a.listCount;
        return a.name.localeCompare(b.name);
      }).slice(0, count);
    }

    const sortByWatchlistPrefer = (items: CuratedFilm[]) => {
      if (watchlistBias !== "prefer") return items;
      return [...items].sort((a, b) => {
        const aSlug = getSlug(a.url);
        const bSlug = getSlug(b.url);
        const aMatch = (aSlug && watchlistSlugs.has(aSlug)) || watchlistTitleYears.has(`${a.name.toLowerCase()}|${a.year ?? ""}`);
        const bMatch = (bSlug && watchlistSlugs.has(bSlug)) || watchlistTitleYears.has(`${b.name.toLowerCase()}|${b.year ?? ""}`);
        return Number(bMatch) - Number(aMatch);
      });
    };

    if (quality === "imdb-popularity") {
      const isImdb = (film: CuratedFilm) =>
        Boolean(film.lists && Object.prototype.hasOwnProperty.call(film.lists, "imdb-top-250"));
      const imdbBucket: CuratedFilm[] = [];
      const otherBucket: CuratedFilm[] = [];
      for (const film of afterSeen) {
        if (isImdb(film)) imdbBucket.push(film);
        else otherBucket.push(film);
      }
      results = [...sortByWatchlistPrefer(imdbBucket), ...sortByWatchlistPrefer(otherBucket)].slice(0, count);
    } else {
      results = sortByWatchlistPrefer(results);
    }

    if (shuffleAllSeed && results.length > 1) {
      results = shuffleResults(results, shuffleAllSeed);
    }

    return { results, rankedCount, randomCount, randomSources, seenExcludedCount };
  }, [
    curatedPayload,
    builderState,
    builderExcluded,
    filteredUris,
    diarySlugs,
    diaryTitleYears,
    watchlistSlugs,
    watchlistTitleYears,
    ORIGIN_CONTINENT_MAP,
    LATIN_AMERICA_COUNTRIES,
    MIDDLE_EAST_COUNTRIES,
  ]);

  const builderResults = builderOutput.results;
  const builderRankedCount = builderOutput.rankedCount;
  const builderRandomCount = builderOutput.randomCount;
  const builderRandomSources = builderOutput.randomSources;
  const builderSeenExcluded = builderOutput.seenExcludedCount;

  const handleBuilderShuffle = useCallback(() => {
    const seed = Date.now();
    setBuilderState((prev) => ({ ...prev, shuffleSeed: seed, shuffleAllSeed: seed }));
  }, []);

  const handleBuilderRemove = useCallback((url: string) => {
    setBuilderExcluded((prev) => (prev.includes(url) ? prev : [...prev, url]));
  }, []);

  const handleBuilderToggle = useCallback(() => {
    const now = Date.now();
    if (now - builderToggleGuard.current < 300) return;
    builderToggleGuard.current = now;
    setBuilderExpanded((v) => !v);
  }, []);

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

  const filteredDiaryRowsForHeatmap = useMemo(() => {
    if (rows.length === 0) return [];
    const activeCriteria = Object.values(diaryFilters).some(Boolean);
    const needsMovieData = activeCriteria || !!decadeFilter || !!geoFilter;
    return rows.filter((row) => {
      const ratingMatch = ratingFilter ? row.Rating === ratingFilter : true;
      if (!ratingMatch) return false;
      if (!needsMovieData) return true;
      if (!movieLookup) return false;
      const uri = (row["Letterboxd URI"] || "").trim();
      const movie = movieLookup[uri] || movieLookup[canonicalizeUri(uri)];
      if (!movie) return false;
      const tmdb = movie.tmdb_data || {};
      const byBlackDirector =
        movie.is_by_black_director === true ||
        (tmdb?.directors || []).some((d: any) => typeof d?.id === "number" && blackDirectorIds.has(d.id));
      if (activeCriteria) {
        const checks: boolean[] = [];
        if (diaryFilters.directedByWoman) checks.push(tmdb.directed_by_woman === true);
        if (diaryFilters.writtenByWoman) checks.push(tmdb.written_by_woman === true);
        if (diaryFilters.byBlackDirector) checks.push(byBlackDirector);
        if (diaryFilters.notAmerican) checks.push(tmdb.is_american === false);
        if (diaryFilters.notEnglish) checks.push(tmdb.is_english === false);
        if (diaryFilters.inCriterion) checks.push(movie.is_in_criterion_collection === true);
        if (diaryFilterMode === "any") {
          if (!checks.some(Boolean)) return false;
        } else {
          if (!checks.every(Boolean)) return false;
        }
      }
      if (decadeFilter && !matchesDecadeFilter(movie)) return false;
      if (geoFilter && !matchesGeoFilter(movie)) return false;
      return true;
    });
  }, [
    rows,
    diaryFilters,
    diaryFilterMode,
    ratingFilter,
    movieLookup,
    blackDirectorIds,
    matchesDecadeFilter,
    matchesGeoFilter,
    canonicalizeUri,
    decadeFilter,
    geoFilter,
  ]);

  const diaryDateCounts = useMemo(() => {
    const byYear = new Map<string, Map<string, number>>();
    for (const row of filteredDiaryRowsForHeatmap) {
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
  }, [filteredDiaryRowsForHeatmap]);

  const heatmapGlobalMax = useMemo(() => {
    let max = 0;
    for (const yearMap of diaryDateCounts.values()) {
      for (const count of yearMap.values()) {
        if (count > max) max = count;
      }
    }
    return max;
  }, [diaryDateCounts]);

  const diaryDateMovies = useMemo(() => {
    const map = new Map<string, Array<{ name: string; year: string }>>();
    for (const row of filteredDiaryRowsForHeatmap) {
      const raw = getWatchedDate(row);
      if (!raw) continue;
      const dateKey = raw.trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
      const name = (row.Name || (row as any).Title || "").trim();
      if (!name) continue;
      const year = (row.Year || (row as any).Year || "").trim();
      if (!map.has(dateKey)) map.set(dateKey, []);
      map.get(dateKey)!.push({ name, year });
    }
    return map;
  }, [filteredDiaryRowsForHeatmap]);

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
  
  const { directedByWoman, writtenByWoman, byBlackDirector, notAmerican, notEnglish, inCriterion } = useMemo(
    () => ({
      directedByWoman: moviesWithData.filter((m: any) => m.tmdb_data?.directed_by_woman === true).length,
      writtenByWoman: moviesWithData.filter((m: any) => m.tmdb_data?.written_by_woman === true).length,
      byBlackDirector: moviesWithData.filter((m: any) => m.is_by_black_director === true).length,
      notAmerican: moviesWithData.filter((m: any) => m.tmdb_data?.is_american === false).length,
      notEnglish: moviesWithData.filter((m: any) => m.tmdb_data?.is_english === false).length,
      inCriterion: moviesWithData.filter((m: any) => m.is_in_criterion_collection === true).length,
    }),
    [moviesWithData]
  );

  const trendSummary = useMemo(() => {
    if (!movieLookup || rows.length === 0) return [];

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const monthKeys: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }

    const metricDefs = [
      { key: "directedByWoman", label: "Directed by women", match: (tmdb: any) => tmdb.directed_by_woman === true },
      { key: "writtenByWoman", label: "Written by women", match: (tmdb: any) => tmdb.written_by_woman === true },
      { key: "byBlackDirector", label: "By Black directors", match: (_tmdb: any, byBlack: boolean) => byBlack },
      { key: "notAmerican", label: "Non-American", match: (tmdb: any) => tmdb.is_american === false },
      { key: "notEnglish", label: "Not in English", match: (tmdb: any) => tmdb.is_english === false },
      { key: "inCriterion", label: "In the Criterion Collection", match: (_tmdb: any, _byBlack: boolean, movie: any) => movie.is_in_criterion_collection === true },
    ];

    const monthStats: Record<string, { total: number; counts: Record<string, number> }> = {};
    for (const key of monthKeys) {
      const counts: Record<string, number> = {};
      for (const metric of metricDefs) {
        counts[metric.key] = 0;
      }
      monthStats[key] = { total: 0, counts };
    }

    for (const row of rows) {
      const watched = getWatchedDate(row);
      if (!watched) continue;
      const date = new Date(watched);
      if (Number.isNaN(date.getTime())) continue;
      if (date < start || date > now) continue;
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      if (!monthStats[monthKey]) continue;

      const uri = (row["Letterboxd URI"] || "").trim();
      if (!uri) continue;
      const movie = movieLookup[uri] || movieLookup[canonicalizeUri(uri)];
      if (!movie?.tmdb_data) continue;

      const tmdb = movie.tmdb_data || {};
      const byBlack =
        movie.is_by_black_director === true ||
        (tmdb.directors || []).some((d: any) => typeof d?.id === "number" && blackDirectorIds.has(d.id));

      const stats = monthStats[monthKey];
      stats.total += 1;
      for (const metric of metricDefs) {
        if (metric.match(tmdb, byBlack, movie)) {
          stats.counts[metric.key] += 1;
        }
      }
    }

    const computeMovingAvg = (series: Array<number | null>) =>
      series.map((_, idx) => {
        const startIdx = Math.max(0, idx - 2);
        const window = series.slice(startIdx, idx + 1).filter((v): v is number => v !== null);
        if (window.length < 2) return null;
        return window.reduce((sum, v) => sum + v, 0) / window.length;
      });

    return metricDefs.map((metric) => {
      const series = monthKeys.map((key) => {
        const total = monthStats[key]?.total || 0;
        if (!total) return null;
        const count = monthStats[key].counts[metric.key] || 0;
        return count / total;
      });

      const monthlyTotals = monthKeys
        .map((key) => monthStats[key]?.total || 0)
        .filter((value) => value > 0);

      const movingAvg = computeMovingAvg(series);
      const valid = movingAvg.filter((v): v is number => v !== null);
      if (valid.length < 2 || monthlyTotals.length < 3) {
        return { key: metric.key, label: metric.label, state: "insufficient", arrow: "—", text: "Not enough data yet" };
      }

      const avgMonthlyTotal =
        monthlyTotals.reduce((sum, value) => sum + value, 0) / monthlyTotals.length;
      const averageProportion =
        series.filter((v): v is number => v !== null).reduce((sum, v) => sum + v, 0) /
        series.filter((v): v is number => v !== null).length;

      const se = Math.sqrt((averageProportion * (1 - averageProportion)) / Math.max(1, avgMonthlyTotal));
      const threshold = Math.max(0.01, 2 * se);

      const slope = valid[valid.length - 1] - valid[0];
      const avgThreeMonthDeltaMovies = Math.abs(slope) * avgMonthlyTotal * 3;
      if (slope >= threshold && avgThreeMonthDeltaMovies >= 3) {
        return { key: metric.key, label: metric.label, state: "rising", arrow: "↑", text: "Rising" };
      }
      if (slope <= -threshold && avgThreeMonthDeltaMovies >= 3) {
        return { key: metric.key, label: metric.label, state: "falling", arrow: "↓", text: "Falling" };
      }
      return { key: metric.key, label: metric.label, state: "steady", arrow: "→", text: "Steady" };
    });
  }, [rows, movieLookup, canonicalizeUri, blackDirectorIds]);
  
  // Debug logging - only create the object if debugging is actually enabled
  if (shouldLogDebug()) {
    logDebug("=== TMDb Stats Debug ===", {
      movieIndexSize: movieIndex ? Object.keys(movieIndex).length : 0,
      movieLookupSize: movieLookup ? Object.keys(movieLookup).length : 0,
      filteredUrisCount: filteredUris.size,
      moviesWithDataCount: totalMoviesWithData,
      stats: { directedByWoman, writtenByWoman, byBlackDirector, notAmerican, notEnglish, inCriterion },
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

  const heatmapFilterLabels = useMemo(() => {
    const labels: string[] = [];
    if (diaryFilters.directedByWoman) labels.push("Directed by women");
    if (diaryFilters.writtenByWoman) labels.push("Written by women");
    if (diaryFilters.byBlackDirector) labels.push("Films by Black directors");
    if (diaryFilters.notAmerican) labels.push("Non-American");
    if (diaryFilters.notEnglish) labels.push("Not in English");
    if (diaryFilters.inCriterion) labels.push("In the Criterion Collection");
    if (ratingFilter) labels.push(`${ratingFilter}★`);
    if (decadeFilter) labels.push(decadeFilter.label);
    if (geoFilter) {
      labels.push(
        geoFilter.type === "continent"
          ? getContinentLabel(geoFilter.value)
          : getCountryName(geoFilter.value)
      );
    }
    if (labels.length > 0) {
      labels.unshift(diaryFilterMode === "any" ? "Match any" : "Match all");
    }
    return labels;
  }, [diaryFilters, ratingFilter, decadeFilter, geoFilter, diaryFilterMode]);

  const joinLabels = useCallback((labels: string[]) => {
    if (labels.length === 0) return "";
    if (labels.length === 1) return labels[0];
    if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
    return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
  }, []);

  const watchlistFilterLabels = useMemo(() => {
    const labels: string[] = [];
    if (watchlistRuntimeFilter === "under90") labels.push("under 90 min");
    if (watchlistRuntimeFilter === "under2h") labels.push("under 2 hours");
    if (watchlistRuntimeFilter === "under2.5h") labels.push("under 2½ hours");
    if (watchlistRuntimeFilter === "over2.5h") labels.push("over 2½ hours");
    if (watchlistFilters.directedByWoman) labels.push("directed by women");
    if (watchlistFilters.writtenByWoman) labels.push("written by women");
    if (watchlistFilters.byBlackDirector) labels.push("films by Black directors");
    if (watchlistFilters.notAmerican) labels.push("non-American");
    if (watchlistFilters.notEnglish) labels.push("not in English");
    if (watchlistFilters.inCriterion) labels.push("in the Criterion Collection");
    if (watchlistContinentFilter) {
      const continentText: Record<string, string> = {
        AF: "African movies",
        EU: "European movies",
        NA: "North American movies",
        SA: "South American movies",
        AS: "Asian movies",
        OC: "Oceanic movies",
        AN: "Antarctic movies",
      };
      labels.push(continentText[watchlistContinentFilter] || `${getContinentLabel(watchlistContinentFilter)} movies`);
    }
    return labels;
  }, [watchlistRuntimeFilter, watchlistFilters, watchlistContinentFilter, watchlistFilterMode]);

  const watchlistFilteredCount = useMemo(() => {
    if (watchlistMovies.length === 0) return 0;
    return watchlistMovies.filter((movie) => {
      const hasActiveCriteria = Object.values(watchlistFilters).some(Boolean);
      if (hasActiveCriteria) {
        const checks: boolean[] = [];
        if (watchlistFilters.directedByWoman) checks.push(movie.directedByWoman);
        if (watchlistFilters.writtenByWoman) checks.push(movie.writtenByWoman);
        if (watchlistFilters.byBlackDirector) checks.push(movie.byBlackDirector);
        if (watchlistFilters.notAmerican) checks.push(movie.notAmerican);
        if (watchlistFilters.notEnglish) checks.push(movie.notEnglish);
        if (watchlistFilters.inCriterion) checks.push(movie.inCriterion);
        if (watchlistFilterMode === "any") {
          if (!checks.some(Boolean)) return false;
        } else {
          if (!checks.every(Boolean)) return false;
        }
      }
      if (watchlistContinentFilter && !movie.continents.includes(watchlistContinentFilter)) return false;
      if (watchlistRuntimeFilter === "under90" && (movie.runtime === null || movie.runtime >= 90)) return false;
      if (watchlistRuntimeFilter === "under2h" && (movie.runtime === null || movie.runtime >= 120)) return false;
      if (watchlistRuntimeFilter === "under2.5h" && (movie.runtime === null || movie.runtime >= 150)) return false;
      if (watchlistRuntimeFilter === "over2.5h" && (movie.runtime === null || movie.runtime < 150)) return false;
      return true;
    }).length;
  }, [watchlistMovies, watchlistFilters, watchlistFilterMode, watchlistContinentFilter, watchlistRuntimeFilter]);

  const watchlistPaceText = useMemo<ReactNode | null>(() => {
    if (!isDiaryFormat) return null;
    if (rows.length === 0 || watchlistMovies.length === 0) return null;
    if (watchlistFilteredCount === 0) return null;

    const now = new Date();
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(now.getMonth() - 6);
    sixMonthsAgo.setHours(0, 0, 0, 0);
    const daysSpan = Math.max(1, Math.round((now.getTime() - sixMonthsAgo.getTime()) / 86400000));

    const recentCount = rows.filter((row) => {
      const raw = getWatchedDate(row);
      if (!raw) return false;
      const date = new Date(raw);
      if (Number.isNaN(date.getTime())) return false;
      return date >= sixMonthsAgo && date <= now;
    }).length;

    if (recentCount === 0) return null;
    const pacePerDay = recentCount / daysSpan;
    if (pacePerDay <= 0) return null;
    const daysRemaining = watchlistFilteredCount / pacePerDay;
    const totalMonths = Math.max(1, Math.round(daysRemaining / 30.44));
    const years = Math.floor(totalMonths / 12);
    const months = totalMonths % 12;

    const hasBlackDirectorFilter = watchlistFilters.byBlackDirector;
    const nonBlackLabels = watchlistFilterLabels.filter((label) => label !== "films by Black directors");
    const hasNonBlackLabels = nonBlackLabels.length > 0;
    const filterPhrase = watchlistFilterLabels.length ? (
      <>
        your watchlist of{" "}
        {hasNonBlackLabels ? joinLabels(nonBlackLabels) : null}
        {hasNonBlackLabels && hasBlackDirectorFilter ? " and " : null}
        {hasBlackDirectorFilter ? (
          <>
            films by Black directors <BlackDirectorsInfo align="center" />
          </>
        ) : null}
        {!hasNonBlackLabels && !hasBlackDirectorFilter ? "movies" : null}
      </>
    ) : (
      "your watchlist"
    );
    const yearLabel = `${years} year${years === 1 ? "" : "s"}`;
    const monthLabel = `${months} month${months === 1 ? "" : "s"}`;

    return (
      <>
        If you watch movies at the same pace as you have been for the past 6 months, you'll finish{" "}
        {filterPhrase} in {yearLabel}, {monthLabel}!
      </>
    );
  }, [
    isDiaryFormat,
    rows,
    watchlistMovies.length,
    watchlistFilteredCount,
    watchlistFilterLabels,
    joinLabels,
    watchlistFilters.byBlackDirector,
  ]);

  const tasteFilmEntries = useMemo(() => {
    if (!movieLookup) return [];
    const map = new Map<string, { movie: any; rating: number; dateKey: string }>();
    for (const row of filteredRows) {
      const uriRaw = (row["Letterboxd URI"] || "").trim();
      if (!uriRaw) continue;
      const canon = canonicalizeUri(uriRaw);
      const movie = movieLookup[uriRaw] || movieLookup[canon];
      if (!movie?.tmdb_data) continue;

      let rating: number | null = null;
      const rawRating = parseFloat(row.Rating);
      if (!Number.isNaN(rawRating)) {
        rating = rawRating;
      } else if (!isDiaryFormat) {
        const tmdbRating = movie.tmdb_data?.vote_average;
        if (typeof tmdbRating === "number" && !Number.isNaN(tmdbRating)) {
          rating = Math.round((tmdbRating / 2) * 10) / 10;
        }
      }

      const dateKey = (getWatchedDate(row) || "").slice(0, 10);
      const mapKey = movie.tmdb_movie_id ? `tmdb:${movie.tmdb_movie_id}` : (movie.letterboxd_url || canon || uriRaw);
      const existing = map.get(mapKey);
      if (!existing || (dateKey && dateKey > existing.dateKey)) {
        map.set(mapKey, { movie, rating: rating ?? NaN, dateKey });
      }
    }
    return Array.from(map.values());
  }, [filteredRows, movieLookup, canonicalizeUri, isDiaryFormat]);

  const tasteFilmEntriesRated = useMemo(
    () => tasteFilmEntries.filter((entry) => !Number.isNaN(entry.rating)),
    [tasteFilmEntries]
  );

  const tasteEntriesForStats = tasteSortMode === "watched" ? tasteFilmEntries : tasteFilmEntriesRated;

  const personFirstDate = useMemo(() => {
    if (!movieLookup) return new Map<string, number>();
    const first = new Map<string, number>();
    for (const row of rows) {
      const uriRaw = (row["Letterboxd URI"] || "").trim();
      if (!uriRaw) continue;
      const canon = canonicalizeUri(uriRaw);
      const movie = movieLookup[uriRaw] || movieLookup[canon];
      if (!movie?.tmdb_data) continue;
      const watched = getWatchedDate(row);
      if (!watched || watched.length < 4) continue;
      const time = new Date(watched).getTime();
      if (Number.isNaN(time)) continue;
      const directors = movie.tmdb_data?.directors || [];
      for (const director of directors) {
        if (!director?.name) continue;
        const key = director.name;
        const existing = first.get(key);
        if (!existing || time < existing) first.set(key, time);
      }
    }
    return first;
  }, [rows, movieLookup, canonicalizeUri]);

  const diversifyNoteRef = useRef<{ lastIndex: number; map: Record<string, string> }>({ lastIndex: -1, map: {} });
  const getDiversifyNote = useCallback((key: string) => {
    if (diversifyNoteRef.current.map[key]) return diversifyNoteRef.current.map[key];
    let nextIndex = (diversifyNoteRef.current.lastIndex + 1) % TASTE_DIVERSIFY_NOTES.length;
    diversifyNoteRef.current.lastIndex = nextIndex;
    const note = TASTE_DIVERSIFY_NOTES[nextIndex];
    diversifyNoteRef.current.map[key] = note;
    return note;
  }, []);

  const buildPeopleStats = useCallback((entries: Array<{ movie: any; rating: number }>, getPeople: (movie: any) => Array<any>) => {
    const stats = new Map<string, { name: string; count: number; ratingSum: number; ratingCount: number; profilePath?: string | null }>();
    for (const entry of entries) {
      const people = getPeople(entry.movie) || [];
      const seen = new Set<string>();
      for (const person of people) {
        const name = person?.name;
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const current = stats.get(name) || { name, count: 0, ratingSum: 0, ratingCount: 0, profilePath: null };
        current.count += 1;
        if (!Number.isNaN(entry.rating)) {
          current.ratingSum += entry.rating;
          current.ratingCount += 1;
        }
        if (!current.profilePath && person?.profile_path) current.profilePath = person.profile_path;
        stats.set(name, current);
      }
    }
    return Array.from(stats.values()).map((p) => ({
      name: p.name,
      count: p.count,
      avgRating: p.ratingCount ? p.ratingSum / p.ratingCount : 0,
      ratingCount: p.ratingCount,
      profilePath: p.profilePath,
    }));
  }, []);

  const getFemaleDirectors = useCallback((movie: any) => {
    const tmdb = movie.tmdb_data || {};
    const directors = tmdb.directors || [];
    if (directors.length === 1 && tmdb.directed_by_woman === true) {
      return directors;
    }
    return directors.filter((d: any) => d.gender === 1);
  }, []);

  const getFemaleWriters = useCallback((movie: any) => {
    const tmdb = movie.tmdb_data || {};
    const writers = tmdb.writers || [];
    if (writers.length === 1 && tmdb.written_by_woman === true) {
      return writers;
    }
    return writers.filter((w: any) => w.gender === 1);
  }, []);


  const rankPeople = useCallback((items: TastePerson[], minCount: number) => {
    const effectiveMin = tasteSortMode === "watched" ? 1 : minCount;
    const filtered = items.filter((p) => p.count >= effectiveMin);
    // Shuffle first to randomize ties
    const shuffled = [...filtered].sort(() => Math.random() - 0.5);
    return shuffled.sort((a, b) => {
      if (tasteSortMode === "watched") {
        if (b.count !== a.count) return b.count - a.count;
        if (b.avgRating !== a.avgRating) return b.avgRating - a.avgRating;
        return 0; // Preserve random order for ties
      }
      if (b.avgRating !== a.avgRating) return b.avgRating - a.avgRating;
      if (b.count !== a.count) return b.count - a.count;
      return 0; // Preserve random order for ties
    }).slice(0, 5);
  }, [tasteSortMode]);

  const rankCountries = useCallback((items: TasteCountry[]) => {
    const filtered = tasteSortMode === "rated" ? items.filter((c) => c.count >= 2) : items;
    // Shuffle first to randomize ties
    const shuffled = [...filtered].sort(() => Math.random() - 0.5);
    return shuffled.sort((a, b) => {
      if (tasteSortMode === "watched") {
        if (b.count !== a.count) return b.count - a.count;
        if (b.avgRating !== a.avgRating) return b.avgRating - a.avgRating;
        return 0; // Preserve random order for ties
      }
      if (b.avgRating !== a.avgRating) return b.avgRating - a.avgRating;
      if (b.count !== a.count) return b.count - a.count;
      return 0; // Preserve random order for ties
    }).slice(0, 5);
  }, [tasteSortMode]);

  const tasteData = useMemo(() => {
    const femaleDirectors = buildPeopleStats(tasteEntriesForStats, getFemaleDirectors);
    const femaleWriters = buildPeopleStats(tasteEntriesForStats, getFemaleWriters);
    const womenDirectorsWriters = buildPeopleStats(tasteEntriesForStats, (movie) => {
      const directors = getFemaleDirectors(movie);
      const writers = getFemaleWriters(movie);
      const writerNames = new Set(writers.map((w: any) => w.name));
      return directors.filter((d: any) => writerNames.has(d.name));
    });
    const nonEnglishDirectors = buildPeopleStats(
      tasteEntriesForStats.filter((entry) => entry.movie.tmdb_data?.is_english === false),
      (movie) => movie.tmdb_data?.directors || []
    );
    const nonEnglishWriters = buildPeopleStats(
      tasteEntriesForStats.filter((entry) => entry.movie.tmdb_data?.is_english === false),
      (movie) => movie.tmdb_data?.writers || []
    );

    const countryStatsMap = new Map<string, { code: string; name: string; count: number; ratingSum: number }>();
    for (const entry of tasteEntriesForStats) {
      const codes = entry.movie.tmdb_data?.production_countries?.codes || [];
      const names = entry.movie.tmdb_data?.production_countries?.names || [];
      const seen = new Set<string>();
      codes.forEach((code: string, idx: number) => {
        if (!code || seen.has(code)) return;
        seen.add(code);
        const name = names[idx] || getCountryName(code);
        const current = countryStatsMap.get(code) || { code, name, count: 0, ratingSum: 0 };
        current.count += 1;
        current.ratingSum += entry.rating;
        countryStatsMap.set(code, current);
      });
    }
    const countries = Array.from(countryStatsMap.values()).map((c) => ({
      code: c.code,
      name: c.name,
      count: c.count,
      avgRating: c.count ? c.ratingSum / c.count : 0,
    }));

    const now = new Date();
    const cutoffTime = now.getTime() - 365 * 24 * 60 * 60 * 1000;
    const newDiscoveryEntries = tasteEntriesForStats.filter((entry) => {
      if (!entry.dateKey) return false;
      const watchedTime = new Date(entry.dateKey).getTime();
      if (Number.isNaN(watchedTime) || watchedTime < cutoffTime) return false;
      const directors = entry.movie.tmdb_data?.directors || [];
      return directors.some((d: any) => {
        const firstSeen = personFirstDate.get(d.name);
        return typeof firstSeen === "number" && firstSeen >= cutoffTime;
      });
    });
    const newDiscoveries = buildPeopleStats(newDiscoveryEntries, (movie) => movie.tmdb_data?.directors || []);

    const allDirectors = buildPeopleStats(tasteEntriesForStats, (movie) => movie.tmdb_data?.directors || []);
    // Shuffle first to randomize ties
    const shuffledDirectors = [...allDirectors.filter((p) => p.count >= 3)].sort(() => Math.random() - 0.5);
    const badHabit = shuffledDirectors
      .sort((a, b) => {
        if (a.avgRating !== b.avgRating) return a.avgRating - b.avgRating;
        if (b.count !== a.count) return b.count - a.count;
        return 0; // Preserve random order for ties
      })
      .slice(0, 5);

    return [
      { key: "womenDirectors", label: "Women Directors", type: "person", items: rankPeople(femaleDirectors, 2) },
      { key: "womenWriters", label: "Women Writers", type: "person", items: rankPeople(femaleWriters, 2) },
      { key: "womenDirectorsWriters", label: "Women Who Direct + Write", type: "person", items: rankPeople(womenDirectorsWriters, 2) },
      { key: "nonEnglishDirectors", label: "Directors of Non-English Language Films", type: "person", items: rankPeople(nonEnglishDirectors, 2) },
      { key: "nonEnglishWriters", label: "Writers of Non-English Language Films", type: "person", items: rankPeople(nonEnglishWriters, 2) },
      { key: "topCountries", label: "Top Countries", type: "country", items: rankCountries(countries) },
      { key: "newDiscoveries", label: "New Discoveries", type: "person", items: rankPeople(newDiscoveries, 2) },
      { key: "badHabit", label: "Bad Habit Detector", type: "person", items: badHabit },
    ];
  }, [
    tasteEntriesForStats,
    buildPeopleStats,
    rankPeople,
    rankCountries,
    personFirstDate,
    tasteSortMode,
    getFemaleDirectors,
    getFemaleWriters,
  ]);

  const tasteVisibleCategories = useMemo(() => {
    if (tasteSortMode === "watched") {
      return tasteData.filter((c) => c.key !== "badHabit");
    }
    return tasteData;
  }, [tasteData, tasteSortMode]);

  const activeTasteCategory = tasteVisibleCategories.find((c) => c.key === tasteCategory) || tasteVisibleCategories[0];
  const diversifyNote = useMemo(() => {
    if (!activeTasteCategory) return null;
    const items = activeTasteCategory.items as any[];
    if (!items || items.length >= 5) return null;
    return getDiversifyNote(activeTasteCategory.key);
  }, [activeTasteCategory, getDiversifyNote]);

  const tasteExplainers = useMemo(() => ({
    newDiscoveries: "Directors you watched for the first time this year.",
    badHabit: "Creators you watch a lot but rate the lowest.",
  }), []);

  const tasteCategoryHelper = useMemo(() => {
    if (!activeTasteCategory) return "";
    if (activeTasteCategory.key === "newDiscoveries") return tasteExplainers.newDiscoveries;
    if (activeTasteCategory.key === "badHabit") return tasteExplainers.badHabit;
    return "";
  }, [activeTasteCategory, tasteExplainers]);

  const tasteCriteriaLine = useMemo(() => {
    if (!activeTasteCategory) return "";
    if (activeTasteCategory.type === "country") {
      const minNote = tasteSortMode === "rated" ? " (min 2 films)" : "";
      const ratingNote = !isDiaryFormat ? " (ratings from TMDb)" : "";
      return `Top 5 by ${tasteSortMode === "rated" ? "highest average rating" : "most watched"}${minNote}${ratingNote}.`;
    }
    if (activeTasteCategory.key === "newDiscoveries") {
      const ratingNote = !isDiaryFormat ? " (ratings from TMDb)" : "";
      return `Directors first watched in the last 365 days with 2+ films, ranked by ${tasteSortMode === "rated" ? "highest average rating" : "most watched"}${ratingNote}.`;
    }
    if (activeTasteCategory.key === "badHabit") {
      const ratingNote = !isDiaryFormat ? " (ratings from TMDb)" : "";
      return `Directors with 3+ films, sorted by lowest average rating${ratingNote}.`;
    }
    const ratingNote = !isDiaryFormat ? " (ratings from TMDb)" : "";
    return `Includes people with 2+ films, ranked by ${tasteSortMode === "rated" ? "highest average rating" : "most watched"}${ratingNote}.`;
  }, [activeTasteCategory, tasteSortMode, isDiaryFormat]);

  const tasteExpandedPersonMovies = useMemo(() => {
    if (!activeTasteCategory || activeTasteCategory.type !== "person") return new Map<string, Array<{ title: string; year: string; rating: string }>>();
    const map = new Map<string, Array<{ title: string; year: string; rating: string }>>();
    const wantsWriter = ["womenWriters", "nonEnglishWriters"].includes(activeTasteCategory.key);
    const wantsDirector = ["womenDirectors", "nonEnglishDirectors", "newDiscoveries", "badHabit", "womenDirectorsWriters"].includes(activeTasteCategory.key);
    for (const entry of tasteFilmEntries) {
      const tmdb = entry.movie.tmdb_data || {};
      const title = tmdb.title || "Untitled";
      const year = tmdb.release_date?.slice(0, 4) || "";
      const rating = entry.rating.toFixed(1);
      const directors = tmdb.directors || [];
      const writers = tmdb.writers || [];
      const names = new Set<string>();
      if (wantsDirector) directors.forEach((d: any) => d?.name && names.add(d.name));
      if (wantsWriter) writers.forEach((w: any) => w?.name && names.add(w.name));
      if (activeTasteCategory.key === "womenDirectorsWriters") {
        const writerNames = new Set(writers.map((w: any) => w.name));
        names.clear();
        directors.filter((d: any) => d?.name && writerNames.has(d.name)).forEach((d: any) => names.add(d.name));
      }
      if (activeTasteCategory.key === "badHabit" || activeTasteCategory.key === "newDiscoveries") {
        names.clear();
        directors.forEach((d: any) => d?.name && names.add(d.name));
      }
      for (const name of names) {
        const list = map.get(name) || [];
        list.push({ title, year, rating });
        map.set(name, list);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (b.rating !== a.rating) return parseFloat(b.rating) - parseFloat(a.rating);
        return (a.title || "").localeCompare(b.title || "");
      });
    }
    return map;
  }, [activeTasteCategory, tasteFilmEntries]);

  return (
    <main style={{ minHeight: "100vh", backgroundColor: "#14181c", color: "#ccd", display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 16px" }}>
      <Analytics />
      <SpeedInsights />
      <div style={{ width: "100%", maxWidth: "980px", display: "flex", flexDirection: "column", gap: "24px" }}>
        <header style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: "28px", fontWeight: 700, color: "#fff", marginBottom: "6px", letterSpacing: "0.5px" }}>
            Letterbddy
          </h1>
          <div style={{ fontSize: "12px", color: "#9ab", marginBottom: "10px" }}>
            by{" "}
            <a
              href="https://x.com/katswint"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "#c6d2de", textDecoration: "none" }}
            >
              Kat Swint
            </a>
          </div>
        </header>

        <input
          ref={diaryInputRef}
          id="diary-file-input"
          type="file"
          accept=".csv"
          onChange={handleFileChange}
          style={{ display: "none" }}
        />
        <input
          ref={reviewsInputRef}
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
        <input
          ref={watchlistInputRef}
          id="watchlist-file-input"
          type="file"
          accept=".csv"
          onChange={handleWatchlistChange}
          disabled={isWatchlistLoading}
          style={{ display: "none" }}
        />

        {(diaryLoaded || watchlistLoaded || reviewsLoaded) && (
          <section className="lb-upload-pill-row">
            {diaryLoaded && !isLoading && (
              <div className="lb-upload-pill">
                <div>
                  <div className="lb-upload-pill-title">Diary</div>
                  <div className="lb-upload-pill-meta">
                    {rows.length} entries · {films.length} films
                  </div>
                </div>
                <button
                  type="button"
                  className="lb-upload-pill-btn"
                  onClick={() => {
                    setRows([]);
                    setDiaryFileName("No file selected");
                    setIsRssPreview(false);
                    setPendingUploadTarget("diary");
                    requestAnimationFrame(() => {
                      diarySectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                    });
                  }}
                >
                  Replace
                </button>
              </div>
            )}
            {reviewsLoaded && (
              <div className="lb-upload-pill">
                <div>
                  <div className="lb-upload-pill-title">Reviews</div>
                  <div className="lb-upload-pill-meta">{reviews.length} reviews</div>
                </div>
                <button
                  type="button"
                  className="lb-upload-pill-btn"
                  onClick={() => {
                    setReviews([]);
                    setReviewsFileName("No file selected");
                    setPendingUploadTarget("reviews");
                    requestAnimationFrame(() => {
                      reviewsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                    });
                  }}
                >
                  Replace
                </button>
              </div>
            )}
            {watchlistLoaded && !isWatchlistLoading && (
              <div className="lb-upload-pill">
                <div>
                  <div className="lb-upload-pill-title">Watchlist</div>
                  <div className="lb-upload-pill-meta">{watchlistMovies.length} films</div>
                </div>
                <button
                  type="button"
                  className="lb-upload-pill-btn"
                  onClick={() => {
                    setWatchlistMovies([]);
                    setWatchlistFileName("No file selected");
                    setPendingUploadTarget("watchlist");
                    requestAnimationFrame(() => {
                      watchlistSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                    });
                  }}
                >
                  Replace
                </button>
              </div>
            )}
            <button
              type="button"
              className="lb-upload-pill-toggle"
              onClick={() => {
                setManualUploadOpen((prev) => {
                  const next = !prev;
                  if (!next) setPendingUploadTarget(null);
                  return next;
                });
              }}
            >
              {manualUploadOpen ? "Hide upload sections" : "Manage uploads"}
            </button>
          </section>
        )}

        {/* Input section - also opens for reviews since reviews is nested inside */}
        {(manualUploadOpen || pendingUploadTarget === "diary" || pendingUploadTarget === "reviews" || !diaryLoaded || isLoading) && (
          <section
            ref={diarySectionRef}
            style={{ backgroundColor: "rgba(68, 85, 102, 0.2)", borderRadius: "8px", padding: "24px" }}
          >
          <div>
            <label style={{ fontSize: "14px", color: "#ccd", display: "block", marginBottom: "8px" }}>
              Upload Diary CSV
            </label>
            <p style={{ fontSize: "12px", color: "#9ab", marginBottom: "12px" }}>
              Export from Letterboxd: Settings → Import & Export → Export Your Data
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "13px", color: "#9ab" }}>Choose file:</span>
              <label
                htmlFor="diary-file-input"
                style={{
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid #456",
                  backgroundColor: "#2c3440",
                  color: "#ccd",
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
                    setIsRssPreview(false);
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
            <div className="lb-rss-row">
              <span className="lb-rss-label">Or pull your last 50 diary entries:</span>
              <div className="lb-rss-input-wrap">
                <span className="lb-rss-at">@</span>
                <input
                  type="text"
                  value={rssUsername}
                  onChange={(e) => setRssUsername(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      fetchRssPreview();
                    }
                  }}
                  placeholder="letterboxd username"
                  className="lb-rss-input"
                  disabled={rssLoading || isLoading}
                />
              </div>
              <button
                type="button"
                className="lb-rss-btn"
                disabled={rssLoading || isLoading}
                onClick={fetchRssPreview}
              >
                {rssLoading ? "Fetching…" : "Fetch last 50"}
              </button>
            </div>
            <p className="lb-rss-note">
              RSS only includes your most recent 50 diary entries. For full stats, upload your diary.csv.
            </p>
            {rssError && <p className="lb-rss-error">{rssError}</p>}
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
                  <p style={{ fontSize: "12px", color: "#9ab", marginTop: "8px", textAlign: "center" }}>
                    {scrapeProgress.current} / {scrapeProgress.total} ({Math.round((scrapeProgress.current / scrapeProgress.total) * 100)}%)
                  </p>
                ) : (
                  <p style={{ fontSize: "12px", color: "#9ab", marginTop: "8px", textAlign: "center" }}>
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
          {!isLoading && rows.length > 0 && isRssPreview && (
            <div className="lb-rss-preview-note">
              RSS is a quick preview (last 50 entries). For complete stats, upload your full diary.csv.
            </div>
          )}

          {/* Reviews upload (optional) */}
          {rows.length > 0 && (manualUploadOpen || pendingUploadTarget === "reviews" || !reviewsLoaded) && (
            <div
              ref={reviewsSectionRef}
              style={{ marginTop: "20px", paddingTop: "16px", borderTop: "1px solid #345" }}
            >
              <label style={{ fontSize: "14px", color: "#ccd", display: "block", marginBottom: "8px" }}>
                Upload Reviews CSV (optional)
              </label>
              <p style={{ fontSize: "12px", color: "#9ab", marginBottom: "12px" }}>
                For review word count analysis
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "13px", color: "#9ab" }}>Choose file:</span>
                <label
                  htmlFor="reviews-file-input"
                  style={{
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid #456",
                    backgroundColor: "#2c3440",
                    color: "#ccd",
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
        )}

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
            {heatmapFilterLabels.length > 0 && (
              <div className="lb-heatmap-filter-note">
                Heatmap filtered by: {heatmapFilterLabels.join(" · ")}
                {diaryFilters.byBlackDirector && (
                  <>
                    {" "}
                    <BlackDirectorsInfo align="center" />
                  </>
                )}
              </div>
            )}
            {dateFilter === "all" ? (
              <>
                <div ref={heatmapScrollRef} className="lb-heatmap-scroll">
                  {heatmapYears.map((year) => (
                    <HeatmapYear
                      key={year}
                      year={year}
                      counts={diaryDateCounts.get(year)}
                      compact
                      maxCountOverride={heatmapGlobalMax}
                      onHoverCell={(text, dateKey, x, y) => {
                        const edge = 140;
                        const align =
                          x < edge ? "left" : x > window.innerWidth - edge ? "right" : "center";
                        const movies = diaryDateMovies.get(dateKey) || [];
                        setHeatmapTooltip({ text, x, y, align, movies });
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
                  maxCountOverride={heatmapGlobalMax}
                  onHoverCell={(text, dateKey, x, y) => {
                    const edge = 140;
                    const align =
                      x < edge ? "left" : x > window.innerWidth - edge ? "right" : "center";
                    const movies = diaryDateMovies.get(dateKey) || [];
                    setHeatmapTooltip({ text, x, y, align, movies });
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
              color: "#ccd",
              border: "1px solid #345",
              borderRadius: "6px",
              padding: "8px 10px",
              fontSize: "11px",
              whiteSpace: "nowrap",
              boxShadow: "0 4px 10px rgba(0, 0, 0, 0.4)",
              pointerEvents: "none",
              zIndex: 1000,
              maxWidth: "240px",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: heatmapTooltip.movies.length ? "6px" : 0 }}>
              {heatmapTooltip.text}
            </div>
            {heatmapTooltip.movies.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: "16px", whiteSpace: "normal" }}>
                {heatmapTooltip.movies.map((movie, idx) => (
                  <li key={`${movie.name}-${idx}`}>
                    {movie.name}{movie.year ? ` (${movie.year})` : ""}
                  </li>
                ))}
              </ul>
            )}
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
                    <p style={{ fontSize: "11px", color: "#9ab", textAlign: "center" }}>
                      Debug: {filteredUris.size} filtered URIs, {movieLookup ? Object.keys(movieLookup).length : 0} in lookup, {matchedMovies.filter((m: any) => m.tmdb_movie_id).length} tmdb_movie_id, {matchedMovies.filter((m: any) => m.tmdb_data).length} tmdb_data, {matchedMovies.filter((m: any) => m.tmdb_error || m.tmdb_api_error).length} TMDb errors
                    </p>
                    {topTmdbErrors.length > 0 && (
                      <p style={{ fontSize: "11px", color: "#9ab", textAlign: "center" }}>
                        Top errors: {topTmdbErrors.map(([msg, count]) => `${msg} (${count})`).join(", ")}
                      </p>
                    )}
                  </>
                )}

                {/* Pie charts grid */}
                <div className="lb-pie-grid">
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
                    onClick={() => toggleDiaryFilter("directedByWoman")}
                    isSelected={diaryFilters.directedByWoman}
                  />
                  <StatPieChart
                    primaryValue={writtenByWoman}
                    primaryLabel="Written by women"
                    secondaryValue={totalMoviesWithData - writtenByWoman}
                    secondaryLabel="Not women"
                    onClick={() => toggleDiaryFilter("writtenByWoman")}
                    isSelected={diaryFilters.writtenByWoman}
                  />
                  <StatPieChart
                    primaryValue={byBlackDirector}
                    primaryLabel="By Black directors"
                    primaryInfo={<BlackDirectorsInfo align="center" />}
                    secondaryValue={totalMoviesWithData - byBlackDirector}
                    secondaryLabel="Not in list"
                    onClick={() => toggleDiaryFilter("byBlackDirector")}
                    isSelected={diaryFilters.byBlackDirector}
                  />
                  <StatPieChart
                    primaryValue={notAmerican}
                    primaryLabel="Non-American"
                    secondaryValue={totalMoviesWithData - notAmerican}
                    secondaryLabel="American"
                    onClick={() => toggleDiaryFilter("notAmerican")}
                    isSelected={diaryFilters.notAmerican}
                  />
                  <StatPieChart
                    primaryValue={notEnglish}
                    primaryLabel="Not in English"
                    secondaryValue={totalMoviesWithData - notEnglish}
                    secondaryLabel="English"
                    onClick={() => toggleDiaryFilter("notEnglish")}
                    isSelected={diaryFilters.notEnglish}
                  />
                  <StatPieChart
                    primaryValue={inCriterion}
                    primaryLabel="In the Criterion Collection"
                    secondaryValue={totalMoviesWithData - inCriterion}
                    secondaryLabel="Not in Criterion"
                    onClick={() => toggleDiaryFilter("inCriterion")}
                    isSelected={diaryFilters.inCriterion}
                  />
                </div>

                {trendSummary.length > 0 && (
                  <div className="lb-trends">
                    <div className="lb-trends-header">
                      <span className="lb-trends-title">Trends (last 12 months)</span>
                      <TrendInfo align="center" />
                    </div>
                    <p className="lb-trends-sub">Smoothed with a 3-month moving average</p>
                    <div className="lb-trends-grid">
                      {trendSummary.map((trend) => (
                        <div key={trend.key} className="lb-trend-row">
                          <span className="lb-trend-label">{trend.label}</span>
                          <span className={`lb-trend-value lb-trend-${trend.state}`}>
                            {trend.arrow} {trend.text}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <DiaryTable
                  moviesWithData={moviesWithData}
                  blackDirectorIds={blackDirectorIds}
                  diaryRatingMap={diaryRatingMap}
                  diaryFilters={diaryFilters}
                  diaryFilterMode={diaryFilterMode}
                  setDiaryFilterMode={setDiaryFilterMode}
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
                return decadeColors[decade] || "#9ab";
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
                return offsetDecadeColors[decade] || "#9ab";
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

        {moviesWithDataBase.length > 0 && activeTasteCategory && (
          <section className="lb-taste-dna">
            <div className="lb-taste-header">
              <div>
                <h2>Taste DNA</h2>
                <p>Top creators and trends in your diary</p>
              </div>
              <div className="lb-taste-toggle">
                <button
                  type="button"
                  className={`lb-taste-toggle-btn ${tasteSortMode === "rated" ? "is-active" : ""}`}
                  onClick={() => setTasteSortMode("rated")}
                >
                  Highest rated
                </button>
                <button
                  type="button"
                  className={`lb-taste-toggle-btn ${tasteSortMode === "watched" ? "is-active" : ""}`}
                  onClick={() => setTasteSortMode("watched")}
                >
                  Most watched
                </button>
              </div>
            </div>
            <div className="lb-taste-tabs">
              {tasteVisibleCategories.map((cat) => (
                <button
                  key={cat.key}
                  type="button"
                  className={`lb-taste-tab ${tasteCategory === cat.key ? "is-active" : ""}`}
                  onClick={() => setTasteCategory(cat.key)}
                >
                  {cat.label}
                </button>
              ))}
            </div>
            <div className="lb-taste-body">
              {tasteCategoryHelper && (
                <div className="lb-taste-subnote">{tasteCategoryHelper}</div>
              )}
              {activeTasteCategory.type === "person" ? (
                <div className="lb-taste-grid">
                  {(activeTasteCategory.items as TastePerson[]).map((person) => (
                    <button
                      key={person.name}
                      type="button"
                      className={`lb-taste-card${tasteExpandedPerson === person.name ? " is-expanded" : ""}`}
                      onClick={() => {
                        setTasteExpandedPerson((prev) => (prev === person.name ? null : person.name));
                      }}
                    >
                      <div className="lb-taste-avatar">
                        {person.profilePath ? (
                          <img
                            src={`${TMDB_PROFILE_BASE}${person.profilePath}`}
                            alt={person.name}
                            loading="lazy"
                          />
                        ) : (
                          <span>{person.name.split(" ").slice(0, 2).map((p) => p[0]).join("").toUpperCase()}</span>
                        )}
                      </div>
                      <div className="lb-taste-name">{person.name}</div>
                      <div className="lb-taste-meta">
                        {person.ratingCount > 0 ? `★${person.avgRating.toFixed(1)}` : "★—"} · {person.count} films
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="lb-taste-grid">
                  {(activeTasteCategory.items as TasteCountry[]).map((country) => (
                    <div key={country.code} className="lb-taste-card">
                      <div className="lb-taste-avatar lb-taste-country">
                        <span>{country.code}</span>
                      </div>
                      <div className="lb-taste-name">{country.name}</div>
                      <div className="lb-taste-meta">★{country.avgRating.toFixed(1)} · {country.count} films</div>
                    </div>
                  ))}
                </div>
              )}
              {tasteExpandedPerson && tasteExpandedPersonMovies.get(tasteExpandedPerson) && (
                <div className="lb-taste-detail lb-taste-table">
                  <div className="lb-taste-detail-title">{tasteExpandedPerson} — films you've watched</div>
                  <div className="lb-taste-detail-head">
                    <div>Title</div>
                    <div>Year</div>
                    <div>Rating</div>
                  </div>
                  <div className="lb-taste-detail-body">
                    {(tasteExpandedPersonMovies.get(tasteExpandedPerson) || []).map((movie, idx) => (
                      <div key={`${movie.title}-${idx}`} className={`lb-taste-detail-row ${idx % 2 === 1 ? "is-alt" : ""}`}>
                        <div className="lb-taste-detail-cell">{movie.title}</div>
                        <div className="lb-taste-detail-cell lb-taste-center">{movie.year || "—"}</div>
                        <div className="lb-taste-detail-cell lb-taste-center">★{movie.rating}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {diversifyNote && (
                <div className="lb-taste-note">{diversifyNote}</div>
              )}
            </div>
          </section>
        )}
        {moviesWithDataBase.length > 0 && activeTasteCategory && (
          <div className="lb-taste-criteria lb-taste-criteria-outside">{tasteCriteriaLine}</div>
        )}

        {/* World map by country/continent */}
        {moviesWithDataBase.length > 0 && (
          <WorldMap
            countryCounts={countryCounts}
            continentCounts={continentCounts}
            maxCountryCount={maxCountryCount}
            maxContinentCount={maxContinentCount}
            geoView={geoView}
            setGeoView={setGeoView}
            geoFilter={geoFilter}
            setGeoFilter={setGeoFilter}
          />
        )}

        {/* Review stats - only show if reviews have been uploaded */}
        {reviews.length > 0 && (() => {
          const stopwords = new Set([
            "the", "and", "for", "that", "with", "this", "was", "but", "are", "you", "your",
            "from", "they", "their", "just", "have", "has", "had", "she", "him", "her", "his",
            "not", "what", "when", "where", "who", "why", "how", "its", "it's", "into", "out",
            "about", "over", "under", "after", "before", "then", "than", "too", "very", "really",
            "also", "still", "more", "most", "least", "been", "were", "because", "could", "would",
            "should", "did", "does", "doing", "done", "cant", "can't", "won", "won't", "dont", "don't",
          ]);
          const positiveWords = new Set([
            "amazing", "beautiful", "brilliant", "charming", "clever", "emotional", "fun",
            "funny", "great", "gorgeous", "heartbreaking", "hilarious", "joy", "lovely",
            "masterpiece", "perfect", "stunning", "terrific", "wonderful", "wow", "love",
            "loved", "favorite", "favourite", "incredible",
          ]);
          const negativeWords = new Set([
            "awful", "bad", "boring", "confusing", "cringe", "dull", "flat", "forgettable",
            "hate", "hated", "mess", "poor", "ridiculous", "slow", "terrible", "ugh",
            "unwatchable", "weak", "worst", "waste", "annoying",
          ]);

          const reviewEntries = reviews
            .map((review) => {
              const text = (review.Review || "").trim();
              const words = text.split(/\s+/).filter((w) => w.length > 0);
              const rating = review.Rating ? Number(review.Rating) : null;
              const date = review["Watched Date"] || review.Date || "";
              return { review, text, words, wordCount: words.length, rating, date };
            })
            .filter((entry) => entry.text.length > 0);

          if (reviewEntries.length === 0) {
            return (
              <section style={{ borderTop: "1px solid rgba(68, 85, 102, 0.5)", paddingTop: "24px", width: "100%" }}>
                <h3 style={{ fontSize: "16px", fontWeight: 600, color: "#fff", marginBottom: "16px", textAlign: "center" }}>
                  Reviews
                </h3>
                <div style={{ textAlign: "center", color: "#9ab", fontSize: "13px" }}>
                  Add written reviews to unlock insights here.
                </div>
              </section>
            );
          }

          const wordCounts = reviewEntries.map((entry) => entry.wordCount);
          const sortedWordCounts = [...wordCounts].sort((a, b) => a - b);
          const mid = Math.floor(sortedWordCounts.length / 2);
          const medianWordCount = sortedWordCounts.length % 2 === 1
            ? sortedWordCounts[mid]
            : Math.round((sortedWordCounts[mid - 1] + sortedWordCounts[mid]) / 2);
          const totalWords = wordCounts.reduce((sum, count) => sum + count, 0);
          const avgWordCount = Math.round(totalWords / wordCounts.length);
          const shortestReview = Math.min(...wordCounts);
          const longestReview = Math.max(...wordCounts);
          const over200 = wordCounts.filter((count) => count >= 200).length;
          const percentOver200 = Math.round((over200 / wordCounts.length) * 100);
          const voiceLabel =
            avgWordCount >= 200 ? "essayist" : avgWordCount >= 80 ? "balanced" : "punchy";

          const sentimentByMonth = new Map<string, { total: number; count: number }>();
          const sentimentPoints: Array<{ month: string; sentiment: number; count: number }> = [];
          for (const entry of reviewEntries) {
            const tokens = entry.text
              .toLowerCase()
              .replace(/[^a-z0-9\s']/g, " ")
              .split(/\s+/)
              .filter((w) => w.length > 2);
            let score = 0;
            for (const token of tokens) {
              if (positiveWords.has(token)) score += 1;
              if (negativeWords.has(token)) score -= 1;
            }
            const normalized = tokens.length ? score / tokens.length : 0;
            if (!entry.date) continue;
            const dateObj = new Date(entry.date);
            if (Number.isNaN(dateObj.getTime())) continue;
            const monthKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, "0")}`;
            const bucket = sentimentByMonth.get(monthKey) || { total: 0, count: 0 };
            bucket.total += normalized;
            bucket.count += 1;
            sentimentByMonth.set(monthKey, bucket);
          }
          Array.from(sentimentByMonth.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .forEach(([month, bucket]) => {
              sentimentPoints.push({
                month,
                sentiment: bucket.count ? Number((bucket.total / bucket.count).toFixed(3)) : 0,
                count: bucket.count,
              });
            });

          const scatterPoints = reviewEntries
            .filter((entry) => typeof entry.rating === "number" && !Number.isNaN(entry.rating))
            .map((entry) => ({
              rating: entry.rating,
              words: entry.wordCount,
              title: entry.review.Name,
              year: entry.review.Year,
              date: entry.date,
            }));

          const ratedReviews = reviewEntries.filter((entry) => typeof entry.rating === "number");
          const mostLoved = ratedReviews.reduce((best, entry) => {
            if (!best) return entry;
            if ((entry.rating ?? 0) > (best.rating ?? 0)) return entry;
            if ((entry.rating ?? 0) === (best.rating ?? 0) && entry.wordCount > best.wordCount) return entry;
            return best;
          }, null as typeof reviewEntries[number] | null);
          const mostHated = ratedReviews.reduce((worst, entry) => {
            if (!worst) return entry;
            if ((entry.rating ?? 0) < (worst.rating ?? 0)) return entry;
            if ((entry.rating ?? 0) === (worst.rating ?? 0) && entry.wordCount > worst.wordCount) return entry;
            return worst;
          }, null as typeof reviewEntries[number] | null);

          const lovedIsLong = mostLoved ? mostLoved.wordCount > 80 || mostLoved.text.length > 320 : false;
          const hatedIsLong = mostHated ? mostHated.wordCount > 80 || mostHated.text.length > 320 : false;

          const uniqueWatchedCount = films.length || 0;
          const reviewDensity = uniqueWatchedCount ? Math.round((reviews.length / uniqueWatchedCount) * 100) : 0;

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
              <div className="lb-review-grid">
                <div className="lb-review-card">
                  <div className="lb-review-card-title">Your voice</div>
                  <div className="lb-review-card-metric">{voiceLabel}</div>
                  <div className="lb-review-card-sub">Shortest: {shortestReview} · Longest: {longestReview}</div>
                  <div className="lb-review-card-sub">{percentOver200}% of reviews are 200+ words</div>
                </div>
                <div className="lb-review-card">
                  <div className="lb-review-card-title">Review density</div>
                  <div className="lb-review-card-metric">{reviewDensity}%</div>
                  <div className="lb-review-card-sub">
                    {reviews.length} reviews across {uniqueWatchedCount} watched films
                  </div>
                </div>
              </div>
              <div className="lb-review-grid lb-review-grid-2">
                <div className="lb-review-card lb-review-card-chart">
                  <div className="lb-review-card-title">Sentiment over time</div>
                  {sentimentPoints.length > 0 ? (
                    <div className="lb-review-chart">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={sentimentPoints} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                          <CartesianGrid stroke="rgba(68, 85, 102, 0.35)" strokeDasharray="3 3" />
                          <XAxis dataKey="month" tick={{ fill: "#9ab", fontSize: 10 }} minTickGap={20} />
                          <YAxis tick={{ fill: "#9ab", fontSize: 10 }} width={32} />
                          <Tooltip
                            contentStyle={{ backgroundColor: "#1b2026", border: "1px solid #345", color: "#ccd" }}
                            content={({ payload, label }) => {
                              const point = payload?.[0]?.payload as any;
                              if (!point) return null;
                              return (
                                <div style={{ fontSize: "12px", color: "#ccd", backgroundColor: "#1b2026", border: "1px solid #345", padding: "8px 10px", borderRadius: "6px" }}>
                                  <div style={{ fontWeight: 600 }}>Month: {label}</div>
                                  <div style={{ marginTop: "4px" }}>Sentiment: {Number(point.sentiment).toFixed(3)}</div>
                                  <div>Reviews: {point.count}</div>
                                </div>
                              );
                            }}
                          />
                          <Line type="monotone" dataKey="sentiment" stroke="#3EBDF4" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="lb-review-card-sub">Not enough dated reviews yet.</div>
                  )}
                </div>
                <div className="lb-review-card lb-review-card-chart">
                  <div className="lb-review-card-title">Rating vs word count</div>
                  {scatterPoints.length > 0 ? (
                    <div className="lb-review-chart">
                      <ResponsiveContainer width="100%" height="100%">
                        <ScatterChart margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                          <CartesianGrid stroke="rgba(68, 85, 102, 0.35)" strokeDasharray="3 3" />
                          <XAxis type="number" dataKey="rating" domain={[0, 5]} tick={{ fill: "#9ab", fontSize: 10 }} />
                          <YAxis type="number" dataKey="words" tick={{ fill: "#9ab", fontSize: 10 }} width={36} />
                          <Tooltip
                            contentStyle={{ backgroundColor: "#1b2026", border: "1px solid #345", color: "#ccd" }}
                            cursor={{ stroke: "#3EBDF4", strokeWidth: 1 }}
                            content={({ payload }) => {
                              const point = payload?.[0]?.payload as any;
                              if (!point) return null;
                              return (
                                <div style={{ fontSize: "12px", color: "#ccd", backgroundColor: "#1b2026", border: "1px solid #345", padding: "8px 10px", borderRadius: "6px" }}>
                                  <div style={{ fontWeight: 600 }}>{point.title}{point.year ? ` (${point.year})` : ""}</div>
                                  <div style={{ marginTop: "4px" }}>Rating: ★{Number(point.rating).toFixed(1)}</div>
                                  <div>Words: {point.words}</div>
                                  {point.date && <div style={{ color: "#9ab", marginTop: "4px" }}>{point.date}</div>}
                                </div>
                              );
                            }}
                          />
                          <Scatter data={scatterPoints} fill="#00e054" />
                        </ScatterChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="lb-review-card-sub">Add ratings to see the scatter.</div>
                  )}
                </div>
                <div className="lb-review-card">
                  <div className="lb-review-card-title">Most loved review</div>
                  {mostLoved ? (
                    <>
                      <div className="lb-review-card-metric">{mostLoved.review.Name} ({mostLoved.review.Year}) · ★{mostLoved.rating}</div>
                      <div className={`lb-review-excerpt ${lovedIsLong && !reviewLovedExpanded ? "lb-review-excerpt-collapsed" : ""}`}>
                        <span dangerouslySetInnerHTML={{ __html: sanitizeReviewHtml(mostLoved.text) }} />
                      </div>
                      {lovedIsLong && (
                        <button
                          type="button"
                          className="lb-review-toggle"
                          onClick={() => setReviewLovedExpanded((prev) => !prev)}
                        >
                          {reviewLovedExpanded ? "Show less" : "Read full review"}
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="lb-review-card-sub">No rated reviews yet.</div>
                  )}
                </div>
                <div className="lb-review-card">
                  <div className="lb-review-card-title">Most hated review</div>
                  {mostHated ? (
                    <>
                      <div className="lb-review-card-metric">{mostHated.review.Name} ({mostHated.review.Year}) · ★{mostHated.rating}</div>
                      <div className={`lb-review-excerpt ${hatedIsLong && !reviewHatedExpanded ? "lb-review-excerpt-collapsed" : ""}`}>
                        <span dangerouslySetInnerHTML={{ __html: sanitizeReviewHtml(mostHated.text) }} />
                      </div>
                      {hatedIsLong && (
                        <button
                          type="button"
                          className="lb-review-toggle"
                          onClick={() => setReviewHatedExpanded((prev) => !prev)}
                        >
                          {reviewHatedExpanded ? "Show less" : "Read full review"}
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="lb-review-card-sub">No rated reviews yet.</div>
                  )}
                </div>
              </div>
            </section>
          );
        })()}

        {/* Watchlist Analysis Section - always visible, inner parts conditionally shown */}
        <section
          ref={watchlistSectionRef}
          style={{ backgroundColor: "rgba(68, 85, 102, 0.2)", borderRadius: "8px", padding: "24px" }}
        >
          <h2 style={{ fontSize: "20px", fontWeight: 600, color: "#fff", marginBottom: "16px", textAlign: "center" }}>
            Watchlist Analysis
          </h2>
          {/* Only show upload description when upload UI is visible */}
          {(manualUploadOpen || pendingUploadTarget === "watchlist" || !watchlistLoaded || isWatchlistLoading) && (
            <p style={{ fontSize: "12px", color: "#9ab", marginBottom: "16px", textAlign: "center" }}>
              Upload your watchlist.csv to find films matching your criteria
            </p>
          )}

          {/* Upload UI - hide once data is loaded (unless manually opened or replacing) */}
          {(manualUploadOpen || pendingUploadTarget === "watchlist" || !watchlistLoaded || isWatchlistLoading) && (
            <div style={{ marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "13px", color: "#9ab" }}>Choose file:</span>
                <label
                  htmlFor="watchlist-file-input"
                  style={{
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid #456",
                    backgroundColor: "#2c3440",
                    color: "#ccd",
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
          )}

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
                  <p style={{ fontSize: "12px", color: "#9ab", textAlign: "center", marginTop: "4px" }}>
                    {watchlistProgress.current} / {watchlistProgress.total} ({Math.round((watchlistProgress.current / watchlistProgress.total) * 100)}%)
                  </p>
                ) : (
                  <p style={{ fontSize: "12px", color: "#9ab", textAlign: "center", marginTop: "4px" }}>
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
                    <span style={{ color: "#ccd" }}>{row.name || "Untitled"}</span>
                    {row.year ? ` (${row.year})` : ""}
                    <span style={{ color: "#9ab", marginLeft: "6px" }}>{row.originalUri}</span>
                    <span style={{ color: "#9ab", marginLeft: "6px" }}>
                      map:{row.hadUriMap ? "yes" : "no"} lookup:{row.foundInLookup ? "yes" : "no"}
                    </span>
                    {row.tmdbId ? (
                      <span style={{ color: "#9ab", marginLeft: "6px" }}>tmdbId:{row.tmdbId}</span>
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
              watchlistPaceText={watchlistPaceText}
              watchlistFilters={watchlistFilters}
              watchlistFilterMode={watchlistFilterMode}
              setWatchlistFilterMode={setWatchlistFilterMode}
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
        {/* Watchlist Builder section — always visible */}
        <section
          style={{
            backgroundColor: "rgba(68, 85, 102, 0.2)",
            borderRadius: "8px",
            padding: "24px",
          }}
        >
          <button
            type="button"
            onClick={handleBuilderToggle}
            style={{
              cursor: "pointer",
              userSelect: "none",
              background: "none",
              border: "none",
              width: "100%",
              textAlign: "left",
              padding: 0,
            }}
          >
            <h2 style={{ color: "#fff", fontSize: "20px", fontWeight: 600, margin: 0, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
              Watchlist Builder
              <span className="lb-builder-toggle-icon" aria-hidden="true">
                {builderExpanded ? "−" : "+"}
              </span>
            </h2>
            <p style={{ color: "#9ab", fontSize: "12px", margin: "6px 0 0", textAlign: "center" }}>
              Build a custom watchlist from{" "}
              {curatedPayload?.films?.length
                ? `${curatedPayload.films.length.toLocaleString()} acclaimed films`
                : "thousands of acclaimed films"}
            </p>
          </button>

          <div className={`lb-builder-collapse ${builderExpanded ? "lb-builder-collapse--open" : ""}`}>
            <div className="lb-builder-collapse-inner">
              <div style={{ marginTop: "20px" }}>
                <WatchlistBuilder
                  curatedPayload={curatedPayload}
                  curatedLoading={curatedLoading}
                  builderState={builderState}
                  setBuilderState={setBuilderState}
                  builderResults={builderResults}
                  builderRankedCount={builderRankedCount}
                  builderRandomCount={builderRandomCount}
                  builderRandomSources={builderRandomSources}
                  seenExcludedCount={builderSeenExcluded}
                  hasDiary={filteredUris.size > 0}
                  watchlistCount={watchlistMovies.length}
                  onShuffle={handleBuilderShuffle}
                  onRemove={handleBuilderRemove}
                />
              </div>
            </div>
          </div>
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

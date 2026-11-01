/**
 * Nucleo icon surface — every UI glyph in the design system imports from here.
 * Prefer `nucleo-ui-essential-outline-18`; fall back to core essential or a
 * local glyph when an icon is missing from the free packages.
 */
import type { ComponentType, ReactNode, SVGProps } from 'react'
import {
  IconArrowDoorOut3Outline18,
  IconArrowDottedRotateAnticlockwiseOutline18,
  IconBellOutline18,
  IconBookOpenOutline18,
  IconBoxArchiveOutline18,
  IconBoxOutline18,
  IconBullhornOutline18,
  IconPhoneOutline18,
  IconStopwatchOutline18,
  IconSuitcase3Outline18,
  IconAwardOutline18,
  IconGiftOutline18,
  IconFlameOutline18,
  IconChartBarTrendUpOutline18,
  IconFilterOutline18,
  IconAlarmClockOutline18,
  IconHandshakeOutline18,
  IconHeadsetOutline18,
  IconVolumeUpOutline18,
  IconLightbulb3Outline18,
  IconFlag7Outline18,
  IconBookmarkOutline18,
  IconFolderOutline18,
  IconCalendarDaysOutline18,
  IconCalendarOutline18,
  IconCheckOutline18,
  IconChevronDownOutline18,
  IconChevronExpandYOutline18,
  IconChevronLeftOutline18,
  IconChevronRightOutline18,
  IconChevronUpOutline18,
  IconCircleCompose2Outline18,
  IconCircleInfoOutline18,
  IconClipboardOutline18,
  IconComputerOutline18,
  IconCreditCardOutline18,
  IconEarthOutline18,
  IconEnvelopeOutline18,
  IconFileContentOutline18,
  IconGear2Outline18,
  IconHouse2Outline18,
  IconLaptopOutline18,
  IconImageOutline18,
  IconLockOutline18,
  IconLinkOutline18,
  IconMagnifierOutline18,
  IconMicrophoneOutline18,
  IconMinusOutline18,
  IconMoneyBillCoinOutline18,
  IconMsgsOutline18,
  IconMsgWritingOutline18,
  IconNodesOutline18,
  IconPaperclipOutline18,
  IconPaperPlane2Outline18,
  IconPen3Outline18,
  IconPinTackOutline18,
  IconPlusOutline18,
  IconPresentationScreenOutline18,
  IconRefresh2Outline18,
  IconShopOutline18,
  IconSlidersOutline18,
  IconTagOutline18,
  IconThumbsUpOutline18,
  IconTimer2Outline18,
  IconTrashOutline18,
  IconTriangleWarningOutline18,
  IconUnorderedListOutline18,
  IconUserOutline18,
  IconUsersOutline18,
  IconWindowExpandBottomRightOutline18,
  IconXmarkOutline18,
} from 'nucleo-ui-essential-outline-18'
import {
  IconBanOutline24,
  IconBellSlashOutline24,
  IconDownload4Outline24,
  IconExportOutline24,
  IconGridListOutline24,
  IconMagnifierMinusOutline24,
  IconMenu3Outline24,
  IconSidebarRightOutline24,
  IconUpload4Outline24,
} from 'nucleo-core-essential-outline-24'
import { cn } from '../lib/cn'

export type IconProps = SVGProps<SVGSVGElement> & {
  size?: number | string
  title?: string
  strokeWidth?: number
  corners?: 'round' | 'square'
}

export type IconComponent = ComponentType<IconProps>

function glyph(
  viewBox: number,
  paths: (strokeWidth: number) => ReactNode,
): IconComponent {
  return function Glyph({
    strokeWidth = 1.5,
    size = viewBox,
    width,
    height,
    title,
    className,
    ...props
  }: IconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={width ?? size}
        height={height ?? size}
        viewBox={`0 0 ${viewBox} ${viewBox}`}
        fill="none"
        className={className}
        {...props}
      >
        {title ? <title>{title}</title> : null}
        {paths(Number(strokeWidth))}
      </svg>
    )
  }
}

/** Horizontal ellipsis — not in the free essential packs. */
export const MoreHorizontal = glyph(18, (sw) => (
  <>
    <circle cx="4" cy="9" r={sw * 0.7} fill="currentColor" />
    <circle cx="9" cy="9" r={sw * 0.7} fill="currentColor" />
    <circle cx="14" cy="9" r={sw * 0.7} fill="currentColor" />
  </>
))

/** The row-actions glyph. Vertical, so it reads as "this row" rather than "this bar". */
export const MoreVertical = glyph(18, (sw) => (
  <>
    <circle cx="9" cy="4" r={sw * 0.7} fill="currentColor" />
    <circle cx="9" cy="9" r={sw * 0.7} fill="currentColor" />
    <circle cx="9" cy="14" r={sw * 0.7} fill="currentColor" />
  </>
))

/**
 * Sort, as bars of decreasing length beside a direction arrow.
 *
 * Distinct from a bare arrow because the toolbar chip has to say "this list is ordered",
 * not "go down" — and distinct from `ChevronsUpDown`, which the grid header uses to say
 * "this column could be ordered".
 */
export const SortDesc = glyph(18, (sw) => (
  <>
    {stroke('M2.75 4.5h6.5', sw)}
    {stroke('M2.75 9h4.5', sw)}
    {stroke('M2.75 13.5h2.5', sw)}
    {stroke('M13.25 4.5v9', sw)}
    {stroke('M11 11.25l2.25 2.25 2.25-2.25', sw)}
  </>
))

export const SortAsc = glyph(18, (sw) => (
  <>
    {stroke('M2.75 4.5h2.5', sw)}
    {stroke('M2.75 9h4.5', sw)}
    {stroke('M2.75 13.5h6.5', sw)}
    {stroke('M13.25 13.5v-9', sw)}
    {stroke('M11 6.75l2.25-2.25 2.25 2.25', sw)}
  </>
))

/** Eye with a slash — hide a column from the current view. */
export const EyeOff = glyph(18, (sw) => (
  <>
    {stroke('M2.25 9s2.5-4.25 6.75-4.25S15.75 9 15.75 9 13.25 13.25 9 13.25 2.25 9 2.25 9Z', sw)}
    <circle cx="9" cy="9" r="1.75" stroke="currentColor" strokeWidth={sw} />
    {stroke('M3.25 14.75l11.5-11.5', sw)}
  </>
))

/** Eye — a tracked email that was opened. */
export const Eye = glyph(18, (sw) => (
  <>
    {stroke('M2.25 9s2.5-4.25 6.75-4.25S15.75 9 15.75 9 13.25 13.25 9 13.25 2.25 9 2.25 9Z', sw)}
    <circle cx="9" cy="9" r="1.75" stroke="currentColor" strokeWidth={sw} />
  </>
))

/** Four corners pulling outward — take a canvas to the whole viewport. */
export const Maximize = glyph(18, (sw) => (
  <>
    {stroke('M2.75 6.75v-4h4', sw)}
    {stroke('M15.25 6.75v-4h-4', sw)}
    {stroke('M2.75 11.25v4h4', sw)}
    {stroke('M15.25 11.25v4h-4', sw)}
  </>
))

/** Four corners pulling inward — leave full-page mode. */
export const Minimize = glyph(18, (sw) => (
  <>
    {stroke('M6.75 2.75v4h-4', sw)}
    {stroke('M11.25 2.75v4h4', sw)}
    {stroke('M6.75 15.25v-4h-4', sw)}
    {stroke('M11.25 15.25v-4h4', sw)}
  </>
))

/** Reply — the arrow turning back on the message it came from. */
export const Reply = glyph(18, (sw) => (
  <>
    {stroke('M7 4.25 2.75 8.5 7 12.75', sw)}
    {stroke('M2.75 8.5h6.5a6 6 0 0 1 6 6v.75', sw)}
  </>
))

/** Reply all — the same turn, with a second arrow behind it for the rest of the thread. */
export const ReplyAll = glyph(18, (sw) => (
  <>
    {stroke('M5.5 4.25 1.25 8.5 5.5 12.75', sw)}
    {stroke('M9.5 4.25 5.25 8.5 9.5 12.75', sw)}
    {stroke('M5.25 8.5h4.5a6 6 0 0 1 6 6v.75', sw)}
  </>
))

/** Undo — anticlockwise rotate from Nucleo. */
export const Undo2 = IconArrowDottedRotateAnticlockwiseOutline18

/** Eraser — not in the free essential packs. */
export const Eraser = glyph(18, (sw) => (
  <>
    <path
      d="M4.25 11.5 11.5 4.25a1.5 1.5 0 0 1 2.12 0l2.13 2.13a1.5 1.5 0 0 1 0 2.12L8.5 15.75H4.25v-4.25Z"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M7.25 8.5 11.5 12.75"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
    />
    <path
      d="M3.25 15.75h11.5"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
    />
  </>
))

/** Sun — light appearance (not in free Nucleo packs). */
export const Sun = glyph(18, (sw) => (
  <>
    <circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth={sw} />
    <path
      d="M9 1.75v1.5M9 14.75v1.5M1.75 9h1.5M14.75 9h1.5M3.76 3.76l1.06 1.06M13.18 13.18l1.06 1.06M3.76 14.24l1.06-1.06M13.18 4.82l1.06-1.06"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
    />
  </>
))

/** Crescent moon — dark appearance (not in free Nucleo packs). */
export const Moon = glyph(18, (sw) => (
  <path
    d="M15.25 10.35A6.25 6.25 0 0 1 7.65 2.75 6.5 6.5 0 1 0 15.25 10.35Z"
    stroke="currentColor"
    strokeWidth={sw}
    strokeLinecap="round"
    strokeLinejoin="round"
  />
))

/** Simple up arrow for send / primary CTAs. */
export const ArrowUp = glyph(18, (sw) => (
  <>
    <line
      x1="9"
      y1="14.75"
      x2="9"
      y2="3.25"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <polyline
      points="4.5 7.75 9 3.25 13.5 7.75"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </>
))

/** Mirror of ArrowUp — jump-to-latest chrome. */
export const ArrowDown = glyph(18, (sw) => (
  <>
    <line
      x1="9"
      y1="3.25"
      x2="9"
      y2="14.75"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <polyline
      points="4.5 10.25 9 14.75 13.5 10.25"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </>
))

export const ArrowLeft = glyph(18, (sw) => (
  <>
    <line
      x1="14.75"
      y1="9"
      x2="3.25"
      y2="9"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <polyline
      points="7.75 4.5 3.25 9 7.75 13.5"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </>
))

export const ArrowRight = glyph(18, (sw) => (
  <>
    <line
      x1="3.25"
      y1="9"
      x2="14.75"
      y2="9"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <polyline
      points="10.25 4.5 14.75 9 10.25 13.5"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </>
))

/** Outbound — up and away from us. */
export const ArrowUpRight = glyph(18, (sw) => (
  <>
    <line
      x1="4.25"
      y1="13.75"
      x2="13.75"
      y2="4.25"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <polyline
      points="8.75 4.25 13.75 4.25 13.75 9.25"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </>
))

/** Inbound — down and toward us. */
export const ArrowDownLeft = glyph(18, (sw) => (
  <>
    <line
      x1="13.75"
      y1="4.25"
      x2="4.25"
      y2="13.75"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <polyline
      points="4.25 9.25 4.25 13.75 8.75 13.75"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </>
))

/** Filled stop square for mic / stream abort. */
export function Square({ className, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 18 18"
      width="18"
      height="18"
      className={className}
      {...props}
    >
      <rect x="3" y="3" width="12" height="12" rx="1.5" fill="currentColor" />
    </svg>
  )
}

export const Plus = IconPlusOutline18
export const X = IconXmarkOutline18
export const Check = IconCheckOutline18
export const Search = IconMagnifierOutline18
export const SearchX = IconMagnifierMinusOutline24
export const ChevronRight = IconChevronRightOutline18
export const ChevronLeft = IconChevronLeftOutline18
export const ChevronDown = IconChevronDownOutline18
export const ChevronUp = IconChevronUpOutline18
export const ChevronsUpDown = IconChevronExpandYOutline18
export const Paperclip = IconPaperclipOutline18
export const Globe = IconEarthOutline18
export const Share2 = IconExportOutline24
export const Mic = IconMicrophoneOutline18
export const Pencil = IconPen3Outline18
export const Pin = IconPinTackOutline18
export const PinOff = IconPinTackOutline18
export const Trash2 = IconTrashOutline18
export const Copy = IconClipboardOutline18
/**
 * Two overlapping sheets — the copy-this-text mark.
 *
 * The free Nucleo pack only ships a clipboard (`Copy`). A heading action next to
 * words someone wants to take is the two rectangles people look for, not a
 * clipboard.
 */
export const CopySheets = glyph(18, (sw) => (
  <>
    <rect
      x="6.5"
      y="6.5"
      width="8.25"
      height="8.25"
      rx="1.5"
      stroke="currentColor"
      strokeWidth={sw}
      fill="none"
    />
    <path
      d="M4.25 12.25V5.5A1.5 1.5 0 0 1 5.75 4h6.75"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </>
))
export const Folder = IconFolderOutline18
export const Tag = IconTagOutline18
export const Archive = IconBoxArchiveOutline18
export const RefreshCw = IconRefresh2Outline18
export const ThumbsUp = IconThumbsUpOutline18
export const Settings2 = IconGear2Outline18
export const Sliders = IconSlidersOutline18
export const Computer = IconComputerOutline18

/**
 * Keyboard — the commands catalog. The free packs have no keyboard, so this is local:
 * a board with a spacebar, not a letter, so it still reads at 18px in the settings rail.
 */
export const Keyboard = glyph(18, (sw) => (
  <>
    {stroke('M3.25 5.25h11.5a1.5 1.5 0 0 1 1.5 1.5v5.5a1.5 1.5 0 0 1-1.5 1.5H3.25a1.5 1.5 0 0 1-1.5-1.5v-5.5a1.5 1.5 0 0 1 1.5-1.5Z', sw)}
    {stroke('M5.25 8h1.1', sw)}
    {stroke('M7.75 8h1.1', sw)}
    {stroke('M10.25 8h1.1', sw)}
    {stroke('M12.65 8h1.1', sw)}
    {stroke('M6.35 10.75h5.3', sw)}
  </>
))
export const User = IconUserOutline18
export const Users = IconUsersOutline18
export const LogOut = IconArrowDoorOut3Outline18
export const Box = IconBoxOutline18
export const FileText = IconFileContentOutline18
/** Merge tags: the braces a template is written in. Neither pack ships it. */
export const Braces = glyph(18, (sw) => (
  <>
    {stroke('M7 3.5c-2.15 0-3.25 1.45-3.25 3.4v.7c0 .85-.55 1.4-1.5 1.4.95 0 1.5.55 1.5 1.4v.7c0 1.95 1.1 3.4 3.25 3.4', sw)}
    {stroke('M11 3.5c2.15 0 3.25 1.45 3.25 3.4v.7c0 .85.55 1.4 1.5 1.4-.95 0-1.5.55-1.5 1.4v.7c0 1.95-1.1 3.4-3.25 3.4', sw)}
  </>
))
export const MessageSquare = IconMsgsOutline18
export const Upload = IconUpload4Outline24
export const DownloadSimple = IconDownload4Outline24
export const ShieldAlert = IconTriangleWarningOutline18
export const AlertCircle = IconCircleInfoOutline18
export const Info = IconCircleInfoOutline18
export const TriangleAlert = IconTriangleWarningOutline18
export const Minus = IconMinusOutline18
export const Mail = IconEnvelopeOutline18
export const AlignJustify = IconMenu3Outline24
export const LayoutPanelTop = IconPresentationScreenOutline18
export const List = IconUnorderedListOutline18
export const Table2 = IconGridListOutline24
/** Three bars, the mark for a report view — TrendUp is a sparkline, which is a different question. */
export const ChartBar = glyph(18, (sw) => (
  <>
    {stroke('M3.25 14.75V9.25h3.1v5.5', sw)}
    {stroke('M7.45 14.75V5.5h3.1v9.25', sw)}
    {stroke('M11.65 14.75V3.25h3.1v11.5', sw)}
  </>
))

/* Chart types, for the picker that decides how a report is drawn. Each glyph is the shape
   of the chart it opens rather than a generic "chart" mark: the picker is a row of eight,
   and eight variations on a bar chart is a row nobody can read. */

/** Columns standing on a baseline — the stacked / grouped column chart. */
export const ChartColumn = glyph(18, (sw) => (
  <>
    {stroke('M2.75 15.25h12.5', sw)}
    {stroke('M5.5 15V8.5', sw)}
    {stroke('M9 15V4.25', sw)}
    {stroke('M12.5 15v-4.25', sw)}
  </>
))

/** Bars lying down, ranked — the bar list. */
export const ChartBarsHorizontal = glyph(18, (sw) => (
  <>
    {stroke('M2.75 2.75v12.5', sw)}
    {stroke('M3.25 5.5h9', sw)}
    {stroke('M3.25 9h11.5', sw)}
    {stroke('M3.25 12.5h6', sw)}
  </>
))

export const ChartLine = glyph(18, (sw) => (
  <>
    {stroke('M2.75 2.75v12.5h12.5', sw)}
    {stroke('M5.25 11.75l2.75-3.25 2.25 1.75 3.5-4.5', sw)}
  </>
))

export const ChartArea = glyph(18, (sw) => (
  <>
    {stroke('M2.75 2.75v12.5h12.5', sw)}
    <path
      d="M5.25 11.75l2.75-3.25 2.25 1.75 3.5-4.5v9.5H5.25z"
      fill="currentColor"
      fillOpacity="0.18"
    />
    {stroke('M5.25 11.75l2.75-3.25 2.25 1.75 3.5-4.5', sw)}
  </>
))

export const ChartDonut = glyph(18, (sw) => (
  <>
    <circle cx="9" cy="9" r="6.25" stroke="currentColor" strokeWidth={sw} fill="none" />
    <circle cx="9" cy="9" r="2.5" stroke="currentColor" strokeWidth={sw} fill="none" />
    {stroke('M9 2.75v3.75', sw)}
  </>
))

export const ChartFunnel = glyph(18, (sw) => (
  <>{stroke('M2.75 3.75h12.5l-4.5 5.25v5.25h-3.5V9z', sw)}</>
))

/** A single headline value — the KPI tile. */
export const ChartNumber = glyph(18, (sw) => (
  <>
    <rect
      x="2.75"
      y="3.75"
      width="12.5"
      height="10.5"
      rx="2"
      stroke="currentColor"
      strokeWidth={sw}
      fill="none"
    />
    {stroke('M5.75 8.25h6.5', sw)}
    {stroke('M5.75 11.25h3.5', sw)}
  </>
))

/** Rows crossed with columns — the pivot. */
export const ChartPivot = glyph(18, (sw) => (
  <>
    <rect
      x="2.75"
      y="2.75"
      width="12.5"
      height="12.5"
      rx="2"
      stroke="currentColor"
      strokeWidth={sw}
      fill="none"
    />
    {stroke('M2.75 7h12.5', sw)}
    {stroke('M7 7v8.25', sw)}
  </>
))

/** A target, for a goal on a chart. */
export const Target = glyph(18, (sw) => (
  <>
    <circle cx="9" cy="9" r="6.25" stroke="currentColor" strokeWidth={sw} fill="none" />
    <circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth={sw} fill="none" />
    <circle cx="9" cy="9" r={sw * 0.55} fill="currentColor" />
  </>
))

/* The report builder's three verbs. Not in the free Nucleo packs, and the builder reads as a
   sentence — *count of calls, by day, split by rep* — so each chip needs a mark for what it
   does to the data rather than three variations on a funnel. */

/** Stacked planes: the dimension a report is cut down the side by. */
export const Layers = glyph(18, (sw) => (
  <>
    {stroke('M9 2.75 15.25 6 9 9.25 2.75 6z', sw)}
    {stroke('M2.75 9.5 9 12.75 15.25 9.5', sw)}
    {stroke('M2.75 12.75 9 16l6.25-3.25', sw)}
  </>
))

/** One flow parting into two: the breakdown across the top. */
export const SplitBranch = glyph(18, (sw) => (
  <>
    {stroke('M2.75 9h4.5', sw)}
    {stroke('M7.25 9 11.5 4.75h3.75', sw)}
    {stroke('M7.25 9l4.25 4.25h3.75', sw)}
  </>
))

/** Sigma: the aggregate a report computes. */
export const Sum = glyph(18, (sw) => (
  <>{stroke('M13 3.75H4.75L9.25 9l-4.5 5.25H13', sw)}</>
))
/** Camera: taking a photo of a document. The free packs carry none. */
export const Camera = glyph(18, (sw) => (
  <>
    {stroke('M2.75 6.5a1.75 1.75 0 0 1 1.75-1.75h1.1l.9-1.5h5.5l.9 1.5h1.1a1.75 1.75 0 0 1 1.75 1.75v6a1.75 1.75 0 0 1-1.75 1.75h-9A1.75 1.75 0 0 1 2.75 12.5z', sw)}
    <circle cx="9" cy="9.5" r="2.5" stroke="currentColor" strokeWidth={sw} fill="none" />
  </>
))
export const Calendar = IconCalendarOutline18
export const CalendarClock = IconCalendarDaysOutline18
export const Clock = IconTimer2Outline18
export const Image = IconImageOutline18
export const MessageCircleOff = IconBanOutline24
export const MessageCirclePlus = IconCircleCompose2Outline18
export const MessageCircle = IconMsgWritingOutline18
export const Cable = IconLinkOutline18
export const Link = IconLinkOutline18
export const Megaphone = IconBullhornOutline18

/** LinkedIn mark — brand glyph not in free Nucleo packs. */
export const LinkedIn = glyph(18, (sw) => (
  <>
    <rect
      x="2.25"
      y="2.25"
      width="13.5"
      height="13.5"
      rx="2"
      stroke="currentColor"
      strokeWidth={sw}
    />
    <path
      d="M6 7.75v5M6 5.35v.1"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
    />
    <path
      d="M8.75 12.75V9.35c0-.95.7-1.6 1.6-1.6.9 0 1.65.65 1.65 1.7v3.3"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </>
))

/** Official LinkedIn [in] bug — brand glyph for profile / company links. */
export function LinkedInBrand({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={className}
      {...props}
    >
      {/* LinkedIn Blue (#0A66C2). Light corner; letters are the public [in] mark. */}
      <rect width="24" height="24" rx="3" fill="#0A66C2" />
      <path
        fill="#FFFFFF"
        d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452z"
      />
    </svg>
  )
}

/* Closer surfaces: calling, pacing, gamification, filtering. */
export const Phone = IconPhoneOutline18

/*
 * Which line an SDR is about to ring.
 *
 * `Phone` is the handset and stays the generic mark — "there is a number", which is all
 * the vendor's free lookup ever says. These two are for when the kind is actually known,
 * and the distinction is not decoration: a mobile is answered by the person whose name is
 * on the row, and a switchboard is answered by somebody whose job includes not putting
 * you through. Neither shape is in the free essential packs at 18px, so both are local
 * glyphs, drawn on the same grid as the handset so a list mixing all three reads level.
 */

/** A handset in a pocket: the number that reaches the person. */
export const PhoneMobile = glyph(18, (sw) => (
  <>
    <rect
      x="5.25"
      y="2.25"
      width="7.5"
      height="13.5"
      rx="1.75"
      stroke="currentColor"
      strokeWidth={sw}
      fill="none"
    />
    {stroke('M7.75 4.25h2.5', sw)}
    <circle cx="9" cy="13" r={sw * 0.55} fill="currentColor" />
  </>
))

/** A desk set: dialable, and answered by whoever is nearest it. */
export const PhoneLandline = glyph(18, (sw) => (
  <>
    {stroke('M4.75 8.25V5.5a1.75 1.75 0 0 1 1.75-1.75h5a1.75 1.75 0 0 1 1.75 1.75v2.75', sw)}
    <rect
      x="2.25"
      y="8.25"
      width="13.5"
      height="6"
      rx="1.75"
      stroke="currentColor"
      strokeWidth={sw}
      fill="none"
    />
    {stroke('M6.5 11.25h5', sw)}
  </>
))

/** A struck-through circle: a line nobody may ring, and the action that says so. */
export const Ban = IconBanOutline24

export const Stopwatch = IconStopwatchOutline18
export const Award = IconAwardOutline18
export const Gift = IconGiftOutline18
export const Flame = IconFlameOutline18
export const TrendUp = IconChartBarTrendUpOutline18
export const Filter = IconFilterOutline18
export const AlarmClock = IconAlarmClockOutline18
export const Handshake = IconHandshakeOutline18
export const Headset = IconHeadsetOutline18
/** "There is audio for this call." Not a volume control; nothing here has one. */
export const Volume = IconVolumeUpOutline18
/**
 * Speaker with a slash — the dock's mute-call toggle while the line is silent.
 * Neither free pack ships one; Nucleo's volume-up plus `EyeOff`'s slash.
 */
export const VolumeOff = glyph(18, (sw) => (
  <>
    {stroke(
      'M5 5.75H2.25c-.828 0-1.5.672-1.5 1.5v3.5c0 .828.672 1.5 1.5 1.5H5l5.48 3.508c.333.213.77-.026.77-.421V2.664c0-.395-.437-.634-.77-.421L5 5.75Z',
      sw,
    )}
    {stroke('M3.25 14.75l11.5-11.5', sw)}
  </>
))
export const Building = IconShopOutline18
/** A job title — what somebody does, as against the department they sit in. */
export const Briefcase = IconSuitcase3Outline18
export const Lightbulb = IconLightbulb3Outline18
export const Flag = IconFlag7Outline18
export const Bookmark = IconBookmarkOutline18
export const Expand = IconWindowExpandBottomRightOutline18
export const BookOpen = IconBookOpenOutline18
export const CreditCard = IconCreditCardOutline18
export const Home = IconHouse2Outline18
/** This computer — a Chrome notification, which only exists on the machine that allowed it. */
export const Laptop = IconLaptopOutline18
export const Send = IconPaperPlane2Outline18
export const ScanSearch = IconMagnifierOutline18
export const Bell = IconBellOutline18
/** Quiet this notice — not the thing it is about. The dock's second-caller banner. */
export const BellOff = IconBellSlashOutline24
export const Key = IconLockOutline18
/** The same glyph under the name that means "private", not "credentials". */
export const Lock = IconLockOutline18
export const Receipt = IconMoneyBillCoinOutline18
export const ShareNetwork = IconNodesOutline18
export const Storefront = IconShopOutline18

export function ThumbsDown({ className, ...props }: IconProps) {
  return <IconThumbsUpOutline18 className={cn(className, '-scale-y-100')} {...props} />
}

export function PanelLeft({ className, corners, ...props }: IconProps) {
  return (
    <IconSidebarRightOutline24
      className={cn(className, '-scale-x-100')}
      corners={corners}
      {...props}
    />
  )
}

export function PanelRight({ className, corners, ...props }: IconProps) {
  return <IconSidebarRightOutline24 className={className} corners={corners} {...props} />
}

/**
 * The two halves of a size toggle. `Expand` is the window glyph, which says
 * "open this somewhere bigger"; these say "this panel, larger" and "this panel,
 * back" — the pair a composer's title bar needs, and the free packs carry
 * neither.
 */
export const Enlarge = glyph(18, (sw) => (
  <>
    {stroke('M10.75 3.25h4v4', sw)}
    {stroke('M14.75 3.25l-4.5 4.5', sw)}
    {stroke('M7.25 14.75h-4v-4', sw)}
    {stroke('M3.25 14.75l4.5-4.5', sw)}
  </>
))

export const Reduce = glyph(18, (sw) => (
  <>
    {stroke('M14.75 7.25h-4v-4', sw)}
    {stroke('M10.75 7.25l4-4', sw)}
    {stroke('M3.25 10.75h4v4', sw)}
    {stroke('M7.25 10.75l-4 4', sw)}
  </>
))

/* --------------------------------------------------------------------------
   Document editor glyphs
   The free Nucleo packs carry no text-formatting set, so these are local.
   -------------------------------------------------------------------------- */

function stroke(d: string, sw: number) {
  return (
    <path
      d={d}
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  )
}

export const Bold = glyph(18, (sw) => (
  <>
    {stroke('M5.25 3.5h4.4a2.9 2.9 0 0 1 0 5.8H5.25V3.5Z', sw)}
    {stroke('M5.25 9.3h5a2.85 2.85 0 0 1 0 5.7h-5V9.3Z', sw)}
  </>
))

export const Italic = glyph(18, (sw) => (
  <>
    {stroke('M11.25 3.75h-4', sw)}
    {stroke('M10.75 14.25h-4', sw)}
    {stroke('M10.5 3.75 7.5 14.25', sw)}
  </>
))

export const Underline = glyph(18, (sw) => (
  <>
    {stroke('M5 3.25v5.5a4 4 0 0 0 8 0v-5.5', sw)}
    {stroke('M4.25 15.25h9.5', sw)}
  </>
))

export const Strikethrough = glyph(18, (sw) => (
  <>
    {stroke('M3.25 9h11.5', sw)}
    {stroke('M12.5 5.4A3.6 3.6 0 0 0 9 3.5c-2 0-3.4 1.1-3.4 2.6 0 1.2.8 2 2.3 2.5', sw)}
    {stroke('M5.5 12.6A3.7 3.7 0 0 0 9 14.5c2.1 0 3.5-1.1 3.5-2.7 0-1-.5-1.8-1.6-2.3', sw)}
  </>
))

export const Superscript = glyph(18, (sw) => (
  <>
    {stroke('M3 5.25 8.5 14.25', sw)}
    {stroke('M8.5 5.25 3 14.25', sw)}
    {stroke('M11.75 7V4.4a1.4 1.4 0 1 1 2.8 0c0 1-1.1 1.6-2.8 2.6h3', sw)}
  </>
))

export const Subscript = glyph(18, (sw) => (
  <>
    {stroke('M3 3.75 8.5 12.75', sw)}
    {stroke('M8.5 3.75 3 12.75', sw)}
    {stroke('M11.75 15v-2.6a1.4 1.4 0 1 1 2.8 0c0 1-1.1 1.6-2.8 2.6h3', sw)}
  </>
))

/**
 * Blockquote — the rule down the left of quoted lines, not a pair of curly quotes.
 *
 * The email composer's format bar is otherwise all line-and-bar geometry (`AlignLeft`,
 * `ListOrdered`, `IndentIncrease`), and a typographic glyph dropped into that row reads
 * as a different family. This is also what the quote actually looks like in the mail.
 */
export const Quote = glyph(18, (sw) => (
  <>
    {stroke('M3.25 4v10', sw)}
    {stroke('M6.75 5.5h8', sw)}
    {stroke('M6.75 9h8', sw)}
    {stroke('M6.75 12.5h5', sw)}
  </>
))

/** Heading — the letterform, because the alternative is a size the type scale has no name for. */
export const Heading = glyph(18, (sw) => (
  <>
    {stroke('M4.5 3.75v10.5', sw)}
    {stroke('M13.5 3.75v10.5', sw)}
    {stroke('M4.5 9h9', sw)}
  </>
))

export const AlignLeft = glyph(18, (sw) => (
  <>
    {stroke('M3 4.25h12', sw)}
    {stroke('M3 7.75h8', sw)}
    {stroke('M3 11.25h12', sw)}
    {stroke('M3 14.75h8', sw)}
  </>
))

/** Map pin — not in the free packs. Location on a hover card, nowhere else. */
export const MapPin = glyph(18, (sw) => (
  <>
    {stroke('M9 16.25s5.25-4.4 5.25-8.15a5.25 5.25 0 1 0-10.5 0c0 3.75 5.25 8.15 5.25 8.15Z', sw)}
    {stroke('M9 10.15a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8Z', sw)}
  </>
))

export const AlignCenter = glyph(18, (sw) => (
  <>
    {stroke('M3 4.25h12', sw)}
    {stroke('M5 7.75h8', sw)}
    {stroke('M3 11.25h12', sw)}
    {stroke('M5 14.75h8', sw)}
  </>
))

export const AlignRight = glyph(18, (sw) => (
  <>
    {stroke('M3 4.25h12', sw)}
    {stroke('M7 7.75h8', sw)}
    {stroke('M3 11.25h12', sw)}
    {stroke('M7 14.75h8', sw)}
  </>
))

export const ListOrdered = glyph(18, (sw) => (
  <>
    {stroke('M7.25 4.5h8', sw)}
    {stroke('M7.25 9h8', sw)}
    {stroke('M7.25 13.5h8', sw)}
    {stroke('M3 3.25h1.1V6', sw)}
    {stroke('M2.9 7.9h1.6L2.9 10.2h1.7', sw)}
    {stroke('M2.9 12.1h1.5l-.9 1.1a.9.9 0 1 1-.5 1.6', sw)}
  </>
))

/**
 * The handle on a row that can be dragged.
 *
 * Dots rather than strokes, because the strokeWidth every other glyph here scales with
 * would turn a six-dot grip into a smear at 2. Nucleo has no grip; the geometry follows
 * the same 18px box and the same optical weight.
 */
export const GripVertical = glyph(18, () => (
  <>
    {[5, 9, 13].flatMap((y) =>
      [6.5, 11.5].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.1" fill="currentColor" />),
    )}
  </>
))

export const IndentIncrease = glyph(18, (sw) => (
  <>
    {stroke('M8 4.5h7.25', sw)}
    {stroke('M8 9h7.25', sw)}
    {stroke('M3 13.5h12.25', sw)}
    {stroke('M2.75 4.75 5 6.75l-2.25 2', sw)}
  </>
))

export const IndentDecrease = glyph(18, (sw) => (
  <>
    {stroke('M8 4.5h7.25', sw)}
    {stroke('M8 9h7.25', sw)}
    {stroke('M3 13.5h12.25', sw)}
    {stroke('M5 4.75 2.75 6.75l2.25 2', sw)}
  </>
))

export const LineSpacing = glyph(18, (sw) => (
  <>
    {stroke('M8 4.25h7.25', sw)}
    {stroke('M8 9h7.25', sw)}
    {stroke('M8 13.75h7.25', sw)}
    {stroke('M4.25 3.5v11', sw)}
    {stroke('M2.5 5.25 4.25 3.4 6 5.25', sw)}
    {stroke('M2.5 12.75 4.25 14.6 6 12.75', sw)}
  </>
))

export const Redo2 = glyph(18, (sw) => (
  <>
    {stroke('M14.75 6.5H7.5a3.75 3.75 0 1 0 0 7.5h3', sw)}
    {stroke('M11.75 3.5 14.9 6.5l-3.15 3', sw)}
  </>
))

export const Highlighter = glyph(18, (sw) => (
  <>
    {stroke('M9.5 3.75 14 8.25l-4.75 4.75H5.5L3.75 11.25 9.5 3.75Z', sw)}
    {stroke('M3 15.75h12', sw)}
  </>
))

export const TextColor = glyph(18, (sw) => (
  <>
    {stroke('M4.5 11.75 9 3.25l4.5 8.5', sw)}
    {stroke('M6 9h6', sw)}
    {stroke('M3 15.25h12', sw)}
  </>
))

export const ClearFormatting = glyph(18, (sw) => (
  <>
    {stroke('M6.5 3.75h8', sw)}
    {stroke('M10.5 3.75 8 12.5', sw)}
    {stroke('M3.25 14.75 14.75 3.25', sw)}
  </>
))

export const PageBreak = glyph(18, (sw) => (
  <>
    {stroke('M4.5 6.75V2.75h5l3.25 3.25v.75', sw)}
    {stroke('M4.5 11.25v4h8.25v-4', sw)}
    {stroke('M2.25 9h13.5', sw)}
  </>
))

export const Comment = glyph(18, (sw) => (
  <>
    {stroke('M3.25 4.75a1.5 1.5 0 0 1 1.5-1.5h8.5a1.5 1.5 0 0 1 1.5 1.5v5.5a1.5 1.5 0 0 1-1.5 1.5H8l-3.25 2.5v-2.5h-.5a1.5 1.5 0 0 1-1.5-1.5v-5.5Z', sw)}
  </>
))

export const TrackChanges = glyph(18, (sw) => (
  <>
    {stroke('M2.75 12.5 10 5.25l2.75 2.75L5.5 15.25H2.75V12.5Z', sw)}
    {stroke('M11.5 3.75 14.25 6.5', sw)}
    {stroke('M9.75 15.25h5.5', sw)}
  </>
))

export const Outline = glyph(18, (sw) => (
  <>
    {stroke('M3 4h9', sw)}
    {stroke('M5.5 7.75h7.5', sw)}
    {stroke('M8 11.5h7', sw)}
    {stroke('M5.5 15.25h7.5', sw)}
  </>
))

export const Ruler = glyph(18, (sw) => (
  <>
    {stroke('M2.25 6.75h13.5v4.5H2.25v-4.5Z', sw)}
    {stroke('M5.5 6.75v2', sw)}
    {stroke('M9 6.75v2.75', sw)}
    {stroke('M12.5 6.75v2', sw)}
  </>
))

export const Printer = glyph(18, (sw) => (
  <>
    {stroke('M5 6.5V2.75h8V6.5', sw)}
    {stroke('M3.25 6.5h11.5v5h-2v3.75h-7.5V11.5h-2v-5Z', sw)}
    {stroke('M5.75 11.5h6.5', sw)}
  </>
))

export const CaseSensitive = glyph(18, (sw) => (
  <>
    {stroke('M1.75 12.5 5 5.5l3.25 7', sw)}
    {stroke('M3 10.25h4', sw)}
    {stroke('M15.75 9.5a2.6 2.6 0 1 0-5.2 0 2.6 2.6 0 0 0 5.2 0Z', sw)}
    {stroke('M15.75 6.75v5.75', sw)}
  </>
))

export const WholeWord = glyph(18, (sw) => (
  <>
    {stroke('M2.25 5.25h13.5v7.5H2.25v-7.5Z', sw)}
    {stroke('M5.5 10.5 7 7l1.5 3.5', sw)}
    {stroke('M11 7v3.5', sw)}
  </>
))

export const MergeCells = glyph(18, (sw) => (
  <>
    {stroke('M2.5 3.75h13v10.5h-13V3.75Z', sw)}
    {stroke('M2.5 9h4', sw)}
    {stroke('M11.5 9h4', sw)}
    {stroke('M9 6.25v5.5', sw)}
  </>
))

export const InsertRow = glyph(18, (sw) => (
  <>
    {stroke('M2.5 4.25h13v4h-13v-4Z', sw)}
    {stroke('M2.5 12.75h6', sw)}
    {stroke('M12.5 10.25v5', sw)}
    {stroke('M10 12.75h5', sw)}
  </>
))

export const InsertColumn = glyph(18, (sw) => (
  <>
    {stroke('M3.25 2.5h4.5v13h-4.5v-13Z', sw)}
    {stroke('M11.5 2.5v6', sw)}
    {stroke('M12.75 10.5v5', sw)}
    {stroke('M10.25 13h5', sw)}
  </>
))

/* --------------------------------------------------------------------------
   Property-type glyphs

   The CRM grid puts one of these in front of every column header, which is the
   cheapest way to tell somebody that Amount takes a number and Stage takes one of
   a fixed set — a header that reads "Amount" alone tells you nothing until you
   click into a cell and get it wrong. Local because the free packs have no
   field-type set, and they are drawn at the same optical weight as the rest.
   -------------------------------------------------------------------------- */

/** Text: the A over a baseline that every table tool uses for a string column. */
export const TypeText = glyph(18, (sw) => (
  <>
    {stroke('M2.5 10.75 5.75 4l3.25 6.75', sw)}
    {stroke('M3.6 8.75h4.3', sw)}
    {stroke('M11.5 14h4', sw)}
    {stroke('M11.5 10.75h4', sw)}
    {stroke('M2.75 14h5.75', sw)}
  </>
))

export const TypeNumber = glyph(18, (sw) => (
  <>
    {stroke('M6.75 3.25 5.25 14.75', sw)}
    {stroke('M12.25 3.25 10.75 14.75', sw)}
    {stroke('M3.25 6.75h11', sw)}
    {stroke('M2.75 11.25h11', sw)}
  </>
))

/** Select: a tag, because a catalog value is a label pulled off a fixed sheet. */
export const TypeSelect = glyph(18, (sw) => (
  <>
    {stroke('M9.6 2.75H3.5a.75.75 0 0 0-.75.75v6.1c0 .2.08.39.22.53l5.65 5.65a.75.75 0 0 0 1.06 0l5.15-5.15a.75.75 0 0 0 0-1.06L9.6 2.75Z', sw)}
    <circle cx="6.4" cy="6.4" r={sw * 0.75} fill="currentColor" />
  </>
))

export const TypeMultiSelect = glyph(18, (sw) => (
  <>
    {stroke('M7.4 3.25H3.25v4.15l5.9 5.9 4.15-4.15-5.9-5.9Z', sw)}
    {stroke('M10.5 3.25h4.25v4.25', sw)}
    <circle cx="5.9" cy="5.9" r={sw * 0.7} fill="currentColor" />
  </>
))

export const TypeCheckbox = glyph(18, (sw) => (
  <>
    {stroke('M3 4.75a1.5 1.5 0 0 1 1.5-1.5h9a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5h-9a1.5 1.5 0 0 1-1.5-1.5v-8.5Z', sw)}
    {stroke('M6 9.25 8 11.25l4-4.5', sw)}
  </>
))

/** Formula: the fx a spreadsheet uses, so a calculated column reads as read-only. */
export const TypeFormula = glyph(18, (sw) => (
  <>
    {stroke('M4 14.75V5.5a2.25 2.25 0 0 1 2.25-2.25h1', sw)}
    {stroke('M2.75 8.5h4.5', sw)}
    {stroke('M10 8.5l4.25 6', sw)}
    {stroke('M14.25 8.5 10 14.5', sw)}
  </>
))

/* --------------------------------------------------------------------------
   Record-surface glyphs

   The tab strip over a record needs four marks the packs do not carry as a set:
   an overview, a change log, a link and a highlight. Drawn together so they read
   as siblings — four glyphs borrowed from four different families is what makes a
   tab strip look assembled rather than designed.
   -------------------------------------------------------------------------- */

/** Overview: the card grid the tab actually shows. */
export const LayoutGrid = glyph(18, (sw) => (
  <>
    {stroke('M2.75 2.75h5v5h-5z', sw)}
    {stroke('M10.25 2.75h5v5h-5z', sw)}
    {stroke('M2.75 10.25h5v5h-5z', sw)}
    {stroke('M10.25 10.25h5v5h-5z', sw)}
  </>
))

/** History: a clock wound backwards, which is the only thing this tab means. */
export const History = glyph(18, (sw) => (
  <>
    {stroke('M9 4.25a5.75 5.75 0 1 1-5.5 7.5', sw)}
    {stroke('M5.75 2.5 3.1 4.6l2.4 2.15', sw)}
    {stroke('M9 6.75V9l1.9 1.4', sw)}
  </>
))

/** Out of the tab, on top — a window with a smaller one floating in its corner. */
export const PopOut = glyph(18, (sw) => (
  <>
    {stroke('M7.75 14.25h-3.5a1.5 1.5 0 0 1-1.5-1.5v-7.5a1.5 1.5 0 0 1 1.5-1.5h9.5a1.5 1.5 0 0 1 1.5 1.5v2.5', sw)}
    {stroke('M10.75 10.25h3.75a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-.75.75h-3.75a.75.75 0 0 1-.75-.75V11a.75.75 0 0 1 .75-.75Z', sw)}
  </>
))

/** Back into the tab — the arrow returning into the window's corner. */
export const PopIn = glyph(18, (sw) => (
  <>
    {stroke('M4.25 3.75h9.5a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5v-7.5a1.5 1.5 0 0 1 1.5-1.5Z', sw)}
    {stroke('M11.25 6.75 6.75 11.25', sw)}
    {stroke('M6.75 8.25v3h3', sw)}
  </>
))

/** Opens elsewhere — Search in Google, a HubSpot-style external action. */
export const ExternalLink = glyph(18, (sw) => (
  <>
    {stroke('M9.75 3.75h4.5v4.5', sw)}
    {stroke('M8 10 14.25 3.75', sw)}
    {stroke('M14.25 10.25v4H3.75V3.75H7.75', sw)}
  </>
))

/** Associations: two links, one of them this record. */
export const Link2 = glyph(18, (sw) => (
  <>
    {stroke('M7.5 10.5 10.5 7.5', sw)}
    {stroke('M8.6 5.4 10 4a2.9 2.9 0 0 1 4.1 4.1l-1.4 1.4', sw)}
    {stroke('M9.4 12.6 8 14a2.9 2.9 0 0 1-4.1-4.1l1.4-1.4', sw)}
  </>
))

/** Highlights: the CRM's own read on a record, so a spark rather than a star. */
export const Sparkles = glyph(18, (sw) => (
  <>
    {stroke('M7 2.75 8.1 5.9 11.25 7 8.1 8.1 7 11.25 5.9 8.1 2.75 7 5.9 5.9 7 2.75Z', sw)}
    {stroke('M12.75 10.25 13.4 12l1.75.65-1.75.65-.65 1.75-.65-1.75L10.35 12.65 12.1 12l.65-1.75Z', sw)}
  </>
))

/**
 * Favourite / personal default. Outline when unset, filled when this is the one.
 *
 * Not AI glitter — a mark the rep put on a template so Correo opens on it. The packs
 * do not ship a star, so both faces are local and drawn as a pair.
 */
const STAR =
  'M9 2.5l1.86 3.77 4.16.6-3.01 2.94.71 4.14L9 12.01l-3.72 1.94.71-4.14-3.01-2.94 4.16-.6L9 2.5Z'

export const Star = glyph(18, (sw) => stroke(STAR, sw))

export const StarFilled = glyph(18, () => (
  <path d={STAR} fill="currentColor" stroke="none" />
))

/* Recording playback. Neither pack ships a plain play or pause, and the call review
   surface is the only place that needs them. */

export const Play = glyph(18, (sw) => stroke('M6.25 3.75 14 9l-7.75 5.25V3.75Z', sw))

/* Settings › Laboratorio de pruebas. Neither pack ships a flask. */
export const FlaskConical = glyph(18, (sw) => (
  <>
    {stroke('M7 2.75h4', sw)}
    {stroke('M7.75 2.75v4.5L3.6 13.9a1.5 1.5 0 0 0 1.27 2.35h8.26a1.5 1.5 0 0 0 1.27-2.35L10.25 7.25v-4.5', sw)}
    {stroke('M5.4 11.25h7.2', sw)}
  </>
))

export const Pause = glyph(18, (sw) => (
  <>
    {stroke('M6.75 4v10', sw)}
    {stroke('M11.25 4v10', sw)}
  </>
))

/** Voice waveform — the live voice-call entry on the composer. Neither pack ships it. */
export const AudioLines = glyph(18, (sw) => (
  <>
    {stroke('M2.25 7.5v3', sw)}
    {stroke('M5.625 5v8', sw)}
    {stroke('M9 2.75v12.5', sw)}
    {stroke('M12.375 5v8', sw)}
    {stroke('M15.75 7.5v3', sw)}
  </>
))

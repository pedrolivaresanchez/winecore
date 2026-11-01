import { approvalsGetLink, approvalsListPending } from "./approvals";
import {
  billingInvoiceDeliveryMarkFailedTool,
  billingInvoiceDeliveryMarkSentTool,
  billingInvoicePdfGetTool,
  billingInvoicesPendingDeliveryListTool,
} from "./billing-delivery";
import { purchasingExpenseUpload, purchasingExpensesList } from "./expenses";
import { catalogFormatsList, catalogPriceListsList, catalogPriceQuote, catalogProductGet, catalogProductsSearch } from "./catalog";
import { cellarLotGet, cellarOperationDraft, cellarOperationGet, cellarOperationsList, cellarVesselsList } from "./cellar";
import { lotDesignGet, lotPlanFromRecipe, recipesList } from "./lot-design";
import { tastingNoteFromDictation, tastingSessionSamplesList, tastingVoteCast } from "./tasting";
import { contactsCreate, contactsGet, contactsSearch } from "./contacts";
import { inventoryMovementsList, inventoryReconcile, inventoryStockAt } from "./inventory";
import { systemSearch, systemWhoami } from "./system";
import type { AnyTool } from "../registry";
import { billingRestTools } from "./rest/billing";
import { catalogRestTools } from "./rest/catalog";
import { cellarRestTools } from "./rest/cellar";
import { contactsRestTools } from "./rest/contacts";
import { financeRestTools } from "./rest/finance";
import { hygieneRestTools } from "./rest/hygiene";
import { inventoryRestTools } from "./rest/inventory";
import { purchasingRestTools } from "./rest/purchasing";
import { regulatoryRestTools } from "./rest/regulatory";
import { salesRestTools } from "./rest/sales";
import { systemRestTools } from "./rest/system";
import { tastingRestTools } from "./rest/tasting";
import { vineyardRestTools } from "./rest/vineyard";

/** Hand-written tools with business previews. `?tools=compact` lists only these. */
export const coreTools: readonly AnyTool[] = [
  systemWhoami,
  systemSearch,
  approvalsListPending,
  approvalsGetLink,
  contactsSearch,
  contactsGet,
  contactsCreate,
  catalogProductsSearch,
  catalogProductGet,
  catalogFormatsList,
  catalogPriceListsList,
  catalogPriceQuote,
  inventoryStockAt,
  inventoryMovementsList,
  inventoryReconcile,
  cellarVesselsList,
  cellarLotGet,
  cellarOperationsList,
  cellarOperationGet,
  cellarOperationDraft,
  lotDesignGet,
  recipesList,
  lotPlanFromRecipe,
  tastingSessionSamplesList,
  tastingNoteFromDictation,
  tastingVoteCast,
  billingInvoicesPendingDeliveryListTool,
  billingInvoicePdfGetTool,
  billingInvoiceDeliveryMarkSentTool,
  billingInvoiceDeliveryMarkFailedTool,
  purchasingExpensesList,
  purchasingExpenseUpload,
];

/** One tool per thing the web app does, replaying its REST route (see `../rest.ts`). */
export const restTools: readonly AnyTool[] = [
  ...systemRestTools,
  ...contactsRestTools,
  ...catalogRestTools,
  ...salesRestTools,
  ...billingRestTools,
  ...financeRestTools,
  ...purchasingRestTools,
  ...inventoryRestTools,
  ...cellarRestTools,
  ...hygieneRestTools,
  ...vineyardRestTools,
  ...tastingRestTools,
  ...regulatoryRestTools,
];

export const mcpTools: readonly AnyTool[] = [...coreTools, ...restTools];

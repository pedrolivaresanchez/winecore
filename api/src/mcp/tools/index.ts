import { approvalsGetLink, approvalsListPending, approvalsRequestCreate } from "./approvals";
import {
  billingInvoiceDeliveryMarkFailedTool,
  billingInvoiceDeliveryMarkSentTool,
  billingInvoicePdfGetTool,
  billingInvoicesPendingDeliveryListTool,
} from "./billing-delivery";
import { purchasingExpenseApprove, purchasingExpenseUpload, purchasingExpensesList } from "./expenses";
import { catalogFormatsList, catalogPriceListsList, catalogPriceQuote, catalogProductGet, catalogProductsSearch } from "./catalog";
import { cellarLotGet, cellarOperationDraft, cellarOperationGet, cellarOperationsList, cellarVesselsList } from "./cellar";
import { contactsCreate, contactsGet, contactsSearch } from "./contacts";
import { inventoryMovementsList, inventoryReconcile, inventoryStockAt } from "./inventory";
import { systemSearch, systemWhoami } from "./system";
import type { AnyTool } from "../registry";

export const mcpTools: readonly AnyTool[] = [
  systemWhoami,
  systemSearch,
  approvalsListPending,
  approvalsGetLink,
  approvalsRequestCreate,
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
  billingInvoicesPendingDeliveryListTool,
  billingInvoicePdfGetTool,
  billingInvoiceDeliveryMarkSentTool,
  billingInvoiceDeliveryMarkFailedTool,
  purchasingExpensesList,
  purchasingExpenseUpload,
  purchasingExpenseApprove,
];

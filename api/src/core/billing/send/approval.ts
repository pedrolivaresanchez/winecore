/**
 * A batch of invoices leaves WineCore only after a person approves it.
 * Nothing is approved until the approvals module is wired.
 */
export interface BatchSendApprovalHook {
  isApproved(input: { approvalId: string; invoiceId: string }): Promise<boolean>;
}

export const closedBatchSendApproval: BatchSendApprovalHook = {
  async isApproved() {
    return false;
  },
};

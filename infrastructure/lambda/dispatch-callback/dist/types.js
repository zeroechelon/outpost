/**
 * Dispatch Status Callback Lambda Types
 *
 * Type definitions for ECS Task State Change events and dispatch status handling.
 */
/**
 * Dispatch status enum representing the lifecycle states of a dispatch job.
 */
export var DispatchStatus;
(function (DispatchStatus) {
    DispatchStatus["PENDING"] = "PENDING";
    DispatchStatus["RUNNING"] = "RUNNING";
    DispatchStatus["COMPLETED"] = "COMPLETED";
    DispatchStatus["FAILED"] = "FAILED";
    DispatchStatus["TIMEOUT"] = "TIMEOUT";
    DispatchStatus["CANCELLED"] = "CANCELLED";
})(DispatchStatus || (DispatchStatus = {}));
//# sourceMappingURL=types.js.map
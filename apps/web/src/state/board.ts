import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

export const boardLive = createEnvironmentRpcSubscriptionAtomFamily(connectionAtomRuntime, {
  label: "environment-data:board:live",
  tag: WS_METHODS.boardSubscribe,
});

export const boardTaskDetailLive = createEnvironmentRpcSubscriptionAtomFamily(
  connectionAtomRuntime,
  {
    label: "environment-data:board:task-detail:live",
    tag: WS_METHODS.boardTaskDetail,
  },
);

export const boardCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:board:command",
  tag: WS_METHODS.boardCommand,
});

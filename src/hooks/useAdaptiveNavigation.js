import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext.jsx";
import {
  orderByUsage,
  readNavigationUsage,
  recordNavigationUse,
} from "../utils/adaptiveNavigation.js";

export function useAdaptiveNavigation(scope, items, activeKey, getKey = (item) => item) {
  const { user } = useAuth();
  const [usage] = useState(() => readNavigationUsage(user?.id, scope));

  useEffect(() => {
    recordNavigationUse(user?.id, scope, activeKey);
  }, [activeKey, scope, user?.id]);

  return orderByUsage(items, usage, getKey);
}

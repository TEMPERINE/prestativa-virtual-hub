import { useEffect, useState } from "react";
import { getCurrentTheme, subscribeTheme, type OfficeTheme } from "@/lib/office-themes";

export function useOfficeTheme(): OfficeTheme {
  const [theme, setTheme] = useState<OfficeTheme>(() => getCurrentTheme());
  useEffect(() => {
    const update = () => setTheme(getCurrentTheme());
    update();
    return subscribeTheme(update);
  }, []);
  return theme;
}

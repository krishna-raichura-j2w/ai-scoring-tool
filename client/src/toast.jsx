import { createContext, useContext, useState, useCallback } from "react";

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

let idc = 0;

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const toast = useCallback(({ title, description, variant }) => {
    const id = ++idc;
    setItems((p) => [...p, { id, title, description, variant }]);
    setTimeout(() => setItems((p) => p.filter((t) => t.id !== id)), 4000);
  }, []);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80">
        {items.map((t) => (
          <div
            key={t.id}
            className={`rounded-lg border shadow-lg p-4 bg-card animate-in ${
              t.variant === "destructive" ? "border-destructive" : "border-border"
            }`}
          >
            <p className={`text-sm font-semibold ${t.variant === "destructive" ? "text-destructive" : "text-foreground"}`}>
              {t.title}
            </p>
            {t.description && <p className="text-xs text-muted-foreground mt-1">{t.description}</p>}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

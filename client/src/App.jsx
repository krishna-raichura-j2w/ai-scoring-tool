import { ToastProvider } from "./toast.jsx";
import Index from "./Index.jsx";

export default function App() {
  return (
    <ToastProvider>
      <Index />
    </ToastProvider>
  );
}

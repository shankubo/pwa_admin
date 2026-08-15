import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/** Option A (lowest-risk): hand off entirely to the existing, fully-built
 * /restore flow rather than re-hosting its steps inside the Wizard's own
 * shell — reuses 100% of Restore.tsx with zero duplication and zero risk of
 * the two flows drifting apart. */
export function RestoreWizardFlow({ onExit: _onExit }: { onExit: () => void }) {
  const navigate = useNavigate();

  useEffect(() => {
    navigate("/restore");
  }, [navigate]);

  return null;
}

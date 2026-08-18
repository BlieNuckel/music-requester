import { useCallback, useState } from "react";

type Located = (latitude: number, longitude: number) => void;

/** Matches the step on the coordinate inputs; more digits than this is noise. */
const COORDINATE_DECIMALS = 4;

const TIMEOUT_MS = 10_000;

const MESSAGES: Record<number, string> = {
  1: "Location permission was denied in your browser.",
  2: "Your browser could not work out where you are.",
  3: "Locating took too long. Try again or type the coordinates.",
};

function round(value: number): number {
  return Number(value.toFixed(COORDINATE_DECIMALS));
}

function errorMessage(error: GeolocationPositionError): string {
  return MESSAGES[error.code] ?? "Could not get your location.";
}

/**
 * Ask the browser where the user is. Wraps the callback API rather than exposing
 * coordinates as state, so the caller applies them where they belong instead of
 * syncing them out of an effect.
 */
export default function useCurrentPosition() {
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locate = useCallback((onLocated: Located) => {
    // Browsers only hand out coordinates over HTTPS, and a self-hosted install
    // on a LAN is often plain HTTP, where the failure is otherwise unexplained.
    if (!window.isSecureContext) {
      setError("Your browser only shares your location over HTTPS.");
      return;
    }
    if (!navigator.geolocation) {
      setError("This browser cannot share your location.");
      return;
    }

    setLocating(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        onLocated(
          round(position.coords.latitude),
          round(position.coords.longitude)
        );
      },
      (positionError) => {
        setLocating(false);
        setError(errorMessage(positionError));
      },
      { timeout: TIMEOUT_MS }
    );
  }, []);

  return { locate, locating, error };
}

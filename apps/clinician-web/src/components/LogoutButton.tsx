import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function LogoutButton() {
  const { token, logout } = useAuth();
  const navigate = useNavigate();

  if (!token) return null;

  return (
    <button
      className="logout-button"
      onClick={() => {
        logout();
        navigate("/login", { replace: true });
      }}
    >
      Log out
    </button>
  );
}

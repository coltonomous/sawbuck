import { useSession, signOut } from '../lib/auth';

export default function UserMenu() {
  const { data: session } = useSession();

  if (!session) return null;

  const user = session.user;
  const initials = (user.name || user.email)
    .split(/[\s@]/)
    .slice(0, 2)
    .map((s: string) => s[0]?.toUpperCase())
    .join('');

  const handleSignOut = () => {
    signOut({ fetchOptions: { onSuccess: () => { window.location.href = '/login'; } } });
  };

  return (
    <div className="px-3 py-3 border-t border-gray-800">
      <div className="flex items-center gap-2.5 mb-2">
        {user.image ? (
          <img src={user.image} alt="" className="w-7 h-7 rounded-full" />
        ) : (
          <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-[10px] font-bold text-gray-300">
            {initials}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-300 truncate">{user.name || user.email}</p>
          {user.role === 'admin' && (
            <span className="text-[10px] font-medium text-amber-400">Admin</span>
          )}
        </div>
      </div>

      <button
        onClick={handleSignOut}
        className="w-full text-left text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
      >
        Sign out
      </button>
    </div>
  );
}

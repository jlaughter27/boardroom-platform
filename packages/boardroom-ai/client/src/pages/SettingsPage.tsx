import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/auth.store';
import { getUserProfile, updateUserProfile } from '../lib/api';
import { LoadingSpinner } from '../components/shared/LoadingSpinner';
import { ErrorBanner } from '../components/shared/ErrorBanner';
import { CalendarSettings } from '../components/settings/CalendarSettings';
import { SubscriptionSettings } from '../components/settings/SubscriptionSettings';
import type { UserProfile, RiskProfile } from '@boardroom/shared';

const DECISION_FREQUENCY_OPTIONS = [
  'Daily',
  'Several times a week',
  'Weekly',
  'A few times a month',
  'Monthly',
  'Rarely',
];

export default function SettingsPage() {
  const { user, logout } = useAuthStore();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Profile form state
  const [role, setRole] = useState('');
  const [industry, setIndustry] = useState('');
  const [decisionFrequency, setDecisionFrequency] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  // Risk profile state
  const [riskProfile, setRiskProfile] = useState<RiskProfile>({
    financial: 0.5,
    technical: 0.5,
    people: 0.5,
    strategic: 0.5,
  });
  const [riskSaving, setRiskSaving] = useState(false);
  const [riskSaved, setRiskSaved] = useState(false);

  // Values state
  const [valuesText, setValuesText] = useState('');
  const [valuesSaving, setValuesSaving] = useState(false);
  const [valuesSaved, setValuesSaved] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const p = await getUserProfile();
        setProfile(p);
        setRole(p.role ?? '');
        setIndustry(p.industry ?? '');
        setDecisionFrequency(p.decisionFrequency ?? '');
        setRiskProfile(p.riskProfile);
        setValuesText((p.valueHierarchy ?? []).join(', '));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load profile');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function saveProfile() {
    setProfileSaving(true);
    setProfileSaved(false);
    try {
      const updated = await updateUserProfile({ role, industry, decisionFrequency });
      setProfile(updated);
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setProfileSaving(false);
    }
  }

  async function saveRiskProfile() {
    setRiskSaving(true);
    setRiskSaved(false);
    try {
      const updated = await updateUserProfile({ riskProfile });
      setProfile(updated);
      setRiskSaved(true);
      setTimeout(() => setRiskSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save risk profile');
    } finally {
      setRiskSaving(false);
    }
  }

  async function saveValues() {
    setValuesSaving(true);
    setValuesSaved(false);
    try {
      const valueHierarchy = valuesText
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      const updated = await updateUserProfile({ valueHierarchy });
      setProfile(updated);
      setValuesSaved(true);
      setTimeout(() => setValuesSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save values');
    } finally {
      setValuesSaving(false);
    }
  }

  function updateRisk(key: keyof RiskProfile, value: number) {
    setRiskProfile((prev) => ({ ...prev, [key]: value }));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 space-y-6">
      <h1 className="text-2xl font-bold text-white">Settings</h1>

      {error && (
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
      )}

      {/* Profile Section */}
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Profile</h2>
        <div className="space-y-4">
          {/* Read-only fields */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Name</label>
            <div className="text-white text-sm bg-gray-800 rounded-lg px-3 py-2">
              {user?.name ?? '-'}
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Email</label>
            <div className="text-white text-sm bg-gray-800 rounded-lg px-3 py-2">
              {user?.email ?? '-'}
            </div>
          </div>

          {/* Editable fields */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Role</label>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. CTO, Product Manager"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Industry</label>
            <input
              type="text"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="e.g. FinTech, Healthcare"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              Decision Frequency
            </label>
            <select
              value={decisionFrequency}
              onChange={(e) => setDecisionFrequency(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              <option value="">Select...</option>
              {DECISION_FREQUENCY_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={saveProfile}
            disabled={profileSaving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {profileSaving ? 'Saving...' : profileSaved ? 'Saved!' : 'Save Profile'}
          </button>
        </div>
      </section>

      {/* Risk Profile Section */}
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Risk Profile</h2>
        <p className="text-gray-500 text-sm mb-4">
          How comfortable are you with risk in each area? (0 = very risk-averse, 1 = very risk-tolerant)
        </p>
        <div className="space-y-4">
          {(['financial', 'technical', 'people', 'strategic'] as const).map(
            (key) => (
              <div key={key}>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm text-gray-400 capitalize">
                    {key}
                  </label>
                  <span className="text-sm text-gray-300 font-mono">
                    {riskProfile[key].toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={riskProfile[key]}
                  onChange={(e) => updateRisk(key, parseFloat(e.target.value))}
                  className="w-full accent-blue-500"
                />
              </div>
            ),
          )}

          <button
            onClick={saveRiskProfile}
            disabled={riskSaving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {riskSaving ? 'Saving...' : riskSaved ? 'Saved!' : 'Save Risk Profile'}
          </button>
        </div>
      </section>

      {/* Values Section */}
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Values</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">
              What matters most to you?
            </label>
            <input
              type="text"
              value={valuesText}
              onChange={(e) => setValuesText(e.target.value)}
              placeholder="e.g. Growth, Team wellbeing, Innovation, Sustainability"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
            <p className="text-xs text-gray-600 mt-1">
              Separate values with commas, in order of priority.
            </p>
          </div>

          <button
            onClick={saveValues}
            disabled={valuesSaving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {valuesSaving ? 'Saving...' : valuesSaved ? 'Saved!' : 'Save Values'}
          </button>
        </div>
      </section>

      {/* Subscription */}
      <SubscriptionSettings />

      {/* Calendar Integration */}
      <CalendarSettings />

      {/* Account Section */}
      <section className="bg-gray-900 rounded-lg border border-gray-800 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Account</h2>
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-medium text-gray-300 mb-1">
              Change Password
            </h3>
            <p className="text-xs text-gray-500">Coming soon</p>
          </div>

          <div className="border-t border-gray-800 pt-4">
            <button
              onClick={() => logout()}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors"
            >
              Logout
            </button>
          </div>

          <div className="border-t border-gray-800 pt-4">
            <h3 className="text-sm font-medium text-red-400 mb-1">
              Delete Account
            </h3>
            <p className="text-xs text-gray-500">
              To delete your account, please contact support.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

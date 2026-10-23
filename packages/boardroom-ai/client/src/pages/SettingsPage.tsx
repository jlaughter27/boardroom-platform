import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { usePageTitle } from '../hooks/usePageTitle';
import { useAuthStore } from '../stores/auth.store';
import { getUserProfile, updateUserProfile } from '../lib/api';
import { CalendarSettings } from '../components/settings/CalendarSettings';
import { SubscriptionSettings } from '../components/settings/SubscriptionSettings';
import { ConnectedToolsPanel } from '../components/settings/ConnectedToolsPanel';
import { MemoryBudgetPanel } from '../components/settings/MemoryBudgetPanel';
import { PageWrapper, PageHeader, Card, Button, Input, Badge, Skeleton, Select, Slider, useToastStore } from '../components/ui';
import { ErrorBanner } from '../components/shared/ErrorBanner';
import type { UserProfile, RiskProfile } from '@boardroom/shared';

const DECISION_FREQUENCY_OPTIONS = [
  'Daily', 'Several times a week', 'Weekly', 'A few times a month', 'Monthly', 'Rarely',
];

const SECTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'connected-tools', label: 'Connected AI tools' },
  { id: 'memory-budget', label: 'Memory budget' },
  { id: 'subscription', label: 'Subscription' },
  { id: 'account', label: 'Account' },
];

export default function SettingsPage() {
  usePageTitle('Settings');
  const { user, logout } = useAuthStore();
  const addToast = useToastStore((s) => s.addToast);
  const navigate = useNavigate();
  const location = useLocation();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState('profile');

  const [role, setRole] = useState('');
  const [industry, setIndustry] = useState('');
  const [decisionFrequency, setDecisionFrequency] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);

  const [riskProfile, setRiskProfile] = useState<RiskProfile>({
    financial: 0.5, technical: 0.5, people: 0.5, strategic: 0.5,
  });
  const [riskSaving, setRiskSaving] = useState(false);

  const [valuesText, setValuesText] = useState('');
  const [valuesSaving, setValuesSaving] = useState(false);


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

  // Deep links like /settings#settings-subscription (TrialBanner, 402 upgrade CTA)
  // land before the sections render, so scroll once loading finishes.
  useEffect(() => {
    if (loading || !location.hash) return;
    const id = location.hash.replace(/^#settings-/, '').replace(/^#/, '');
    setActiveSection(id);
    document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: 'smooth' });
  }, [loading, location.hash]);

  async function saveProfile() {
    setProfileSaving(true);
    try {
      const updated = await updateUserProfile({ role, industry, decisionFrequency });
      setProfile(updated);
      addToast('Profile saved', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save', 'error');
    } finally {
      setProfileSaving(false);
    }
  }

  async function saveRiskProfile() {
    setRiskSaving(true);
    try {
      const updated = await updateUserProfile({ riskProfile });
      setProfile(updated);
      addToast('Risk profile saved', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save', 'error');
    } finally {
      setRiskSaving(false);
    }
  }

  async function saveValues() {
    setValuesSaving(true);
    try {
      const valueHierarchy = valuesText.split(',').map((v) => v.trim()).filter(Boolean);
      const updated = await updateUserProfile({ valueHierarchy });
      setProfile(updated);
      addToast('Values saved', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save', 'error');
    } finally {
      setValuesSaving(false);
    }
  }

  function updateRisk(key: keyof RiskProfile, value: number) {
    setRiskProfile((prev) => ({ ...prev, [key]: value }));
  }

  function scrollToSection(id: string) {
    setActiveSection(id);
    document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: 'smooth' });
  }

  if (loading) {
    return (
      <PageWrapper>
        <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
          <Skeleton className="h-8 w-32" />
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 rounded-lg" />
          ))}
        </div>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <div className="max-w-4xl mx-auto py-8 px-4 flex gap-8">
        {/* Section nav */}
        <nav className="hidden md:block w-48 shrink-0 sticky top-8 self-start">
          <ul className="space-y-1">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => scrollToSection(s.id)}
                  className={`w-full text-left px-3 py-2 text-sm rounded-md transition-colors ${
                    activeSection === s.id
                      ? 'text-primary-text font-medium border-l-2 border-primary bg-primary/10'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Content */}
        {/* min-w-0: a flex item defaults to min-width:auto, so one long unbreakable line (an MCP URL in the token snippet) would widen the column past the viewport (M1-D3). */}
        <div className="flex-1 min-w-0 space-y-6">
          <PageHeader className="mb-0" title="Settings" subtitle="Profile, preferences, integrations and billing." />

          {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

          {/* Profile */}
          <Card id="settings-profile" className="p-6">
            <h2 className="text-lg font-medium text-foreground mb-4">Profile</h2>
            <div className="space-y-4">
              <Input label="Name" value={user?.name ?? ''} disabled />
              <Input label="Email" value={user?.email ?? ''} disabled />
              <Input label="Role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. CTO, Product Manager" />
              <Input label="Industry" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="e.g. FinTech, Healthcare" />
              <div className="flex flex-col gap-1.5">
                <label htmlFor="decision-frequency" className="text-sm font-medium text-muted-foreground">Decision Frequency</label>
                <Select
                  id="decision-frequency"
                  value={decisionFrequency || undefined}
                  onChange={setDecisionFrequency}
                  placeholder="Select..."
                  options={DECISION_FREQUENCY_OPTIONS.map((opt) => ({ value: opt, label: opt }))}
                />
              </div>
              <Button variant="primary" onClick={saveProfile} disabled={profileSaving}>
                {profileSaving ? 'Saving...' : 'Save Profile'}
              </Button>
            </div>
          </Card>

          {/* Preferences (Risk + Values) */}
          <Card id="settings-preferences" className="p-6">
            <h2 className="text-lg font-medium text-foreground mb-4">Preferences</h2>

            <h3 className="text-sm font-medium text-muted-foreground mb-3">Risk Profile</h3>
            <div className="space-y-4 mb-6">
              {(['financial', 'technical', 'people', 'strategic'] as const).map((key) => (
                <div key={key}>
                  <div className="flex items-center justify-between mb-1">
                    <span id={`risk-${key}-label`} className="text-sm text-muted-foreground capitalize">{key}</span>
                    <Badge variant="default" className="tnum">{riskProfile[key].toFixed(2)}</Badge>
                  </div>
                  <Slider
                    aria-labelledby={`risk-${key}-label`}
                    min={0}
                    max={1}
                    step={0.01}
                    largeStep={0.1}
                    value={riskProfile[key]}
                    onChange={(v) => updateRisk(key, v)}
                    format={(v) => v.toFixed(2)}
                  />
                </div>
              ))}
              <Button variant="primary" onClick={saveRiskProfile} disabled={riskSaving}>
                {riskSaving ? 'Saving...' : 'Save Risk Profile'}
              </Button>
            </div>

            <h3 className="text-sm font-medium text-muted-foreground mb-3">Values</h3>
            <div className="space-y-3">
              {valuesText && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {valuesText.split(',').map((v) => v.trim()).filter(Boolean).map((v, i) => (
                    <Badge key={i} variant="accent">{v}</Badge>
                  ))}
                </div>
              )}
              <Input
                value={valuesText}
                onChange={(e) => setValuesText(e.target.value)}
                placeholder="e.g. Growth, Team wellbeing, Innovation"
              />
              <p className="text-xs text-muted-foreground">Separate values with commas, in order of priority.</p>
              <Button variant="primary" onClick={saveValues} disabled={valuesSaving}>
                {valuesSaving ? 'Saving...' : 'Save Values'}
              </Button>
            </div>
          </Card>

          {/* Integrations */}
          <Card id="settings-integrations" className="p-6">
            <h2 className="text-lg font-medium text-foreground mb-2">Integrations</h2>
            <p className="text-sm text-muted-foreground mb-3">Manage connected tools and services.</p>
            <Button variant="secondary" onClick={() => navigate('/integrations')}>
              Manage Integrations
            </Button>
          </Card>

          {/* Connected AI tools — personal MCP tokens (Lane C) */}
          <div id="settings-connected-tools">
            <ConnectedToolsPanel />
          </div>

          {/* Memory budget — soft per-domain limits (RD-4) */}
          <div id="settings-memory-budget">
            <MemoryBudgetPanel />
          </div>

          {/* Subscription */}
          <div id="settings-subscription">
            <SubscriptionSettings />
          </div>

          {/* Calendar */}
          <CalendarSettings />

          {/* Account */}
          <Card id="settings-account" className="p-6">
            <h2 className="text-lg font-medium text-foreground mb-4">Account</h2>
            <div className="space-y-4">
              <div className="border-b border-border pb-4">
                <Button variant="secondary" onClick={() => logout()}>
                  Logout
                </Button>
              </div>
              <div>
                <h3 className="text-sm font-medium text-destructive mb-1">Delete Account</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  This action is irreversible. All your data will be permanently deleted.
                </p>
                <Button variant="danger" size="sm" disabled title="Account deletion coming soon">
                  Delete Account
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </PageWrapper>
  );
}

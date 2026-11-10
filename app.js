// AccuBiz - Business Account & Project Equity Assistant Core

const SUPABASE_CONFIG = {
  url: 'https://zgkqexzaplzdyuilmhoj.supabase.co',
  key: 'sb_publishable_M_0gphmqtXHzfMCvPQplrg_G9x74TC7'
};

class BusinessAccountingApp {
  constructor() {
    this.currency = '₹';
    this.currentProjectId = 'ALL'; // 'ALL' or specific project ID
    this.currentLedgerFilter = 'ALL';
    this.chartInstances = {};

    // Core Data Entities
    this.projects = [];
    this.stakeholders = [];
    this.distributions = [];
    this.expenses = [];
    this.inflows = [];
    this.loans = [];
    this.repayments = [];

    this.isSupabaseConnected = false;

    try {
      if (window.supabase && SUPABASE_CONFIG.url && SUPABASE_CONFIG.key) {
        this.db = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);
      }
    } catch (e) {
      console.warn('Supabase client init failed, falling back to local storage:', e);
    }

    this.init();
  }

  // --- Smart Number to Words Engine ---
  numberToWords(amount) {
    if (isNaN(amount) || amount === null || amount === '' || Number(amount) === 0) return '';
    const num = Math.abs(Number(amount));
    if (num > 999999999999) return 'Amount too large to display in words';

    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
      'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    const getBelowThousand = (n) => {
      let str = '';
      if (n >= 100) {
        str += ones[Math.floor(n / 100)] + ' Hundred ';
        n %= 100;
      }
      if (n >= 20) {
        str += tens[Math.floor(n / 10)] + ' ';
        n %= 10;
      }
      if (n > 0) {
        str += ones[n] + ' ';
      }
      return str.trim();
    };

    const isIndian = this.currency === '₹' || this.currency === 'INR';
    const integerPart = Math.floor(num);
    const decimalPart = Math.round((num - integerPart) * 100);

    let words = '';

    if (isIndian) {
      let rem = integerPart;
      const crore = Math.floor(rem / 10000000);
      rem %= 10000000;
      const lakh = Math.floor(rem / 100000);
      rem %= 100000;
      const thousand = Math.floor(rem / 1000);
      rem %= 1000;
      const hundredAndBelow = rem;

      if (crore > 0) words += getBelowThousand(crore) + ' Crore ';
      if (lakh > 0) words += getBelowThousand(lakh) + ' Lakh ';
      if (thousand > 0) words += getBelowThousand(thousand) + ' Thousand ';
      if (hundredAndBelow > 0) words += getBelowThousand(hundredAndBelow) + ' ';
    } else {
      let rem = integerPart;
      const billion = Math.floor(rem / 1000000000);
      rem %= 1000000000;
      const million = Math.floor(rem / 1000000);
      rem %= 1000000;
      const thousand = Math.floor(rem / 1000);
      rem %= 1000;
      const hundredAndBelow = rem;

      if (billion > 0) words += getBelowThousand(billion) + ' Billion ';
      if (million > 0) words += getBelowThousand(million) + ' Million ';
      if (thousand > 0) words += getBelowThousand(thousand) + ' Thousand ';
      if (hundredAndBelow > 0) words += getBelowThousand(hundredAndBelow) + ' ';
    }

    words = words.trim();
    if (!words) words = 'Zero';

    let currencyName = 'Rupees';
    let fractionName = 'Paise';
    if (this.currency === '$') { currencyName = 'Dollars'; fractionName = 'Cents'; }
    else if (this.currency === '€') { currencyName = 'Euros'; fractionName = 'Cents'; }
    else if (this.currency === '£') { currencyName = 'Pounds'; fractionName = 'Pence'; }
    else if (this.currency === 'AED') { currencyName = 'Dirhams'; fractionName = 'Fils'; }

    let result = words + ' ' + currencyName;
    if (decimalPart > 0) {
      result += ' and ' + getBelowThousand(decimalPart) + ' ' + fractionName;
    }
    result += ' Only';

    return result;
  }

  updateAmountWords(inputId, targetId) {
    const input = document.getElementById(inputId);
    const target = document.getElementById(targetId);
    if (!input || !target) return;
    const val = parseFloat(input.value);
    if (!val || isNaN(val) || val <= 0) {
      target.innerText = '';
    } else {
      target.innerText = this.numberToWords(val);
    }
  }

  init() {
    const todayStr = new Date().toISOString().split('T')[0];
    ['expDate', 'inflowDate', 'loanDate', 'repayDate', 'projStartDate', 'payoutDate'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = todayStr;
    });

    this.bindEvents();
    this.loadData();
    this.populateProjectDropdowns();
    this.runCalculator();
    this.refreshAll();

    if (this.db) {
      this.syncFromSupabase();
    } else {
      this.updateCloudStatus(false, 'Local Storage');
    }
  }

  updateCloudStatus(connected, text) {
    this.isSupabaseConnected = connected;
    const dot = document.getElementById('syncStatusDot');
    const label = document.getElementById('syncStatusText');
    if (!dot || !label) return;

    if (connected) {
      dot.className = 'w-2 h-2 rounded-full bg-emerald-400';
      label.innerText = text || 'Cloud Synced';
      label.className = 'text-emerald-400';
    } else {
      dot.className = 'w-2 h-2 rounded-full bg-amber-400';
      label.innerText = text || 'Local Storage';
      label.className = 'text-amber-300';
    }
  }

  // --- Project Selector Helpers ---
  populateProjectDropdowns() {
    const selectors = [
      'globalProjectSelector',
      'expenseProjectFilter',
      'expProjectId',
      'inflowProjectId',
      'loanProjectId',
      'stakeholderProjectSelect',
      'payoutProjectSelect'
    ];

    const currentSelVal = document.getElementById('globalProjectSelector')?.value || this.currentProjectId;

    selectors.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;

      const isFilter = id === 'globalProjectSelector' || id === 'expenseProjectFilter';
      let optionsHtml = '';

      if (isFilter) {
        optionsHtml += '<option value="ALL">All Projects (Consolidated)</option>';
      } else if (id === 'loanProjectId') {
        optionsHtml += '<option value="">Company General (No Project)</option>';
      }

      this.projects.forEach(p => {
        optionsHtml += `<option value="${p.id}">${p.name}</option>`;
      });

      el.innerHTML = optionsHtml;
    });

    // Restore selected values
    const globalSel = document.getElementById('globalProjectSelector');
    if (globalSel) globalSel.value = currentSelVal;

    // Set defaults for creation modals
    const defaultProjId = this.currentProjectId !== 'ALL' ? this.currentProjectId : (this.projects[0]?.id || '');
    ['expProjectId', 'inflowProjectId', 'loanProjectId', 'stakeholderProjectSelect', 'payoutProjectSelect'].forEach(id => {
      const el = document.getElementById(id);
      if (el && defaultProjId) el.value = defaultProjId;
    });

    if (defaultProjId) {
      this.updatePayoutStakeholderOptions(defaultProjId);
    }
  }

  handleProjectChange(projectId) {
    this.currentProjectId = projectId;
    const badge = document.getElementById('currentProjectBadge');
    if (badge) {
      if (projectId === 'ALL') {
        badge.innerText = 'All Projects';
        badge.className = 'bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold px-2 py-0.5 rounded-full';
      } else {
        const p = this.projects.find(x => x.id === projectId);
        badge.innerText = p ? p.name : 'Project';
        badge.className = 'bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold px-2 py-0.5 rounded-full';
      }
    }

    // Keep dropdowns in sync
    const expFilter = document.getElementById('expenseProjectFilter');
    if (expFilter) expFilter.value = projectId;

    const modalProjs = ['expProjectId', 'inflowProjectId', 'stakeholderProjectSelect', 'payoutProjectSelect'];
    modalProjs.forEach(mId => {
      const mEl = document.getElementById(mId);
      if (mEl && projectId !== 'ALL') mEl.value = projectId;
    });

    if (projectId !== 'ALL') {
      this.updatePayoutStakeholderOptions(projectId);
    }

    this.refreshAll();
  }

  updatePayoutStakeholderOptions(projectId) {
    const sel = document.getElementById('payoutStakeholderSelect');
    if (!sel) return;

    const targetProject = projectId || this.currentProjectId;
    const partners = this.stakeholders.filter(s => s.projectId === targetProject);

    if (partners.length === 0) {
      sel.innerHTML = '<option value="">No stakeholders registered in this project</option>';
    } else {
      sel.innerHTML = partners.map(s => `
        <option value="${s.id}">${s.name} (${s.stakePercentage}% equity)</option>
      `).join('');
    }
  }

  // --- Financial Computations per Project or Consolidated ---
  calculateFinancials(projectId = this.currentProjectId) {
    const filterFn = (item) => {
      if (projectId === 'ALL') return true;
      return item.projectId === projectId;
    };

    const targetExpenses = this.expenses.filter(filterFn);
    const targetInflows = this.inflows.filter(filterFn);
    const targetLoans = this.loans.filter(filterFn);
    const targetRepayments = this.repayments.filter(r => {
      if (projectId === 'ALL') return true;
      const loan = this.loans.find(l => l.id === r.loanId);
      return loan && loan.projectId === projectId;
    });
    const targetDistributions = this.distributions.filter(d => {
      if (projectId === 'ALL') return true;
      return d.projectId === projectId;
    });

    const totalRevenue = targetInflows.reduce((sum, item) => sum + Number(item.amount), 0);
    const totalExpenses = targetExpenses.reduce((sum, item) => sum + Number(item.amount), 0);
    const totalLoanBorrowed = targetLoans.reduce((sum, item) => sum + Number(item.principal), 0);
    const totalPrincipalRepaid = targetRepayments.reduce((sum, item) => sum + Number(item.principalPart), 0);
    const totalInterestPaid = targetRepayments.reduce((sum, item) => sum + Number(item.interestPart), 0);
    const totalPayoutsDisbursed = targetDistributions.reduce((sum, item) => sum + Number(item.amount), 0);

    const activePrincipalRemaining = Math.max(0, totalLoanBorrowed - totalPrincipalRepaid);

    let estimatedTotalInterestLiability = 0;
    targetLoans.forEach(loan => {
      const p = Number(loan.principal);
      const r = Number(loan.rate) / 100;
      const tYears = Number(loan.tenureMonths) / 12;
      estimatedTotalInterestLiability += (p * r * tYears);
    });

    // Net Liquid Cash in Hand:
    // (Revenues + Loans Inflow) - (Expenses + Principal Repaid + Interest Paid + Partner Payouts)
    const netCashBalance = (totalRevenue + totalLoanBorrowed) - (totalExpenses + totalPrincipalRepaid + totalInterestPaid + totalPayoutsDisbursed);

    // Distributable Net Operating Profit:
    // Direct Revenues - (Operating Expenses + Interest Paid)
    const netOperatingProfit = totalRevenue - (totalExpenses + totalInterestPaid);

    return {
      totalRevenue,
      totalExpenses,
      totalLoanBorrowed,
      totalPrincipalRepaid,
      totalInterestPaid,
      totalPayoutsDisbursed,
      activePrincipalRemaining,
      estimatedTotalInterestLiability,
      netCashBalance,
      netOperatingProfit
    };
  }

  // --- Render All Dashboard & Pages ---
  refreshAll() {
    const stats = this.calculateFinancials(this.currentProjectId);

    // Update Stat Cards
    const netEl = document.getElementById('statNetBalance');
    if (netEl) {
      netEl.innerText = `${this.currency}${stats.netCashBalance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
      netEl.className = stats.netCashBalance < 0 
        ? 'text-2xl lg:text-3xl font-extrabold text-rose-600 tracking-tight'
        : 'text-2xl lg:text-3xl font-extrabold text-emerald-600 tracking-tight';
    }

    const expEl = document.getElementById('statTotalExpenses');
    if (expEl) expEl.innerText = `${this.currency}${stats.totalExpenses.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

    const loanEl = document.getElementById('statActiveLoans');
    if (loanEl) loanEl.innerText = `${this.currency}${stats.activePrincipalRemaining.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

    const profitEl = document.getElementById('statNetProfit');
    if (profitEl) {
      profitEl.innerText = `${this.currency}${stats.netOperatingProfit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
      profitEl.className = stats.netOperatingProfit < 0
        ? 'text-2xl lg:text-3xl font-extrabold text-rose-600 tracking-tight'
        : 'text-2xl lg:text-3xl font-extrabold text-indigo-600 tracking-tight';
    }

    const expCountEl = document.getElementById('statExpenseBreakdownCount');
    const filteredExp = this.expenses.filter(e => this.currentProjectId === 'ALL' || e.projectId === this.currentProjectId);
    if (expCountEl) expCountEl.innerText = `${filteredExp.length} expense item${filteredExp.length === 1 ? '' : 's'}`;

    const activeLoansCount = this.loans.filter(l => (this.currentProjectId === 'ALL' || l.projectId === this.currentProjectId) && this.getLoanRemainingPrincipal(l.id) > 0);
    const loanCountEl = document.getElementById('statActiveLoanCount');
    if (loanCountEl) loanCountEl.innerText = `${activeLoansCount.length} active borrowing${activeLoansCount.length === 1 ? '' : 's'}`;

    const scopeNote = document.getElementById('statBalanceScopeNote');
    if (scopeNote) {
      scopeNote.innerHTML = `<i class="ph ph-info mr-1 text-slate-400"></i> ${this.currentProjectId === 'ALL' ? 'Consolidated across all business projects' : 'Liquid balance reserved for this project'}`;
    }

    const chartScopeLabel = document.getElementById('chartScopeLabel');
    if (chartScopeLabel) {
      chartScopeLabel.innerText = this.currentProjectId === 'ALL' ? 'Consolidated' : 'Project Scope';
    }

    this.renderDashboardLoanList();
    this.renderDashboardStakeholders();
    this.renderStakeholdersSection();
    this.renderCharts();
    this.renderExpenses();
    this.renderInflows();
    this.renderLoans();
    this.renderLedger();
  }

  // --- Stakeholders & Equity Rendering ---
  renderDashboardStakeholders() {
    const container = document.getElementById('dashboardStakeholdersList');
    if (!container) return;

    const displayProjects = this.currentProjectId === 'ALL' 
      ? this.projects 
      : this.projects.filter(p => p.id === this.currentProjectId);

    if (displayProjects.length === 0 || this.stakeholders.length === 0) {
      container.innerHTML = `
        <div class="py-6 text-center text-slate-400 text-xs">
          <i class="ph ph-users text-2xl text-slate-300 mb-1"></i>
          <p>No stakeholders registered yet.</p>
          <button onclick="window.app && window.app.openModal('stakeholderModal')" class="mt-1 text-indigo-600 font-semibold hover:underline">Add Stakeholder</button>
        </div>
      `;
      return;
    }

    let html = '';
    displayProjects.forEach(proj => {
      const projPartners = this.stakeholders.filter(s => s.projectId === proj.id);
      if (projPartners.length === 0) return;

      const pFinancials = this.calculateFinancials(proj.id);
      const netProfit = pFinancials.netOperatingProfit;

      html += `
        <div class="p-3 bg-slate-50 border border-slate-100 rounded-xl space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-slate-800">${proj.name}</span>
            <span class="text-[11px] font-semibold text-indigo-600">Profit: ${this.currency}${netProfit.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
          </div>
          <div class="space-y-1.5 pt-1 border-t border-slate-200/60">
            ${projPartners.map(partner => {
              const partnerProfitShare = (netProfit * (partner.stakePercentage / 100));
              const payouts = this.distributions
                .filter(d => d.stakeholderId === partner.id)
                .reduce((sum, d) => sum + Number(d.amount), 0);
              const due = Math.max(0, partnerProfitShare - payouts);

              return `
                <div class="flex items-center justify-between text-xs">
                  <div class="flex items-center space-x-1.5">
                    <span class="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                    <span class="font-medium text-slate-700">${partner.name}</span>
                    <span class="text-[10px] text-slate-400">(${partner.stakePercentage}%)</span>
                  </div>
                  <div class="text-right">
                    <span class="font-bold text-slate-900">${this.currency}${due.toLocaleString(undefined, {minimumFractionDigits: 0})}</span>
                    <span class="text-[10px] text-slate-400 block -mt-0.5">due</span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    });

    container.innerHTML = html || '<div class="py-4 text-center text-slate-400 text-xs">No partners registered for selected scope.</div>';
  }

  renderStakeholdersSection() {
    const cardsContainer = document.getElementById('projectEquityCardsContainer');
    const distTableBody = document.getElementById('distributionsTableBody');
    const emptyDistMsg = document.getElementById('emptyDistributionsMsg');

    if (cardsContainer) {
      const displayProjects = this.currentProjectId === 'ALL' 
        ? this.projects 
        : this.projects.filter(p => p.id === this.currentProjectId);

      if (displayProjects.length === 0) {
        cardsContainer.innerHTML = `
          <div class="py-12 text-center bg-white rounded-2xl border border-slate-200 text-slate-400">
            <i class="ph ph-folder-notch-open text-4xl mb-2 text-slate-300"></i>
            <p>No projects found. Create your first project to configure stakeholders.</p>
            <button onclick="window.app && window.app.openModal('projectModal')" class="mt-3 inline-flex items-center space-x-1 text-xs font-bold text-emerald-600 hover:underline">
              <span>+ Create Project</span>
            </button>
          </div>
        `;
      } else {
        cardsContainer.innerHTML = displayProjects.map(proj => {
          const partners = this.stakeholders.filter(s => s.projectId === proj.id);
          const totalStake = partners.reduce((sum, p) => sum + Number(p.stakePercentage), 0);
          const financials = this.calculateFinancials(proj.id);
          const netProfit = financials.netOperatingProfit;

          return `
            <div class="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-5">
              <!-- Project Header -->
              <div class="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
                <div>
                  <div class="flex items-center space-x-2">
                    <h4 class="font-bold text-slate-900 text-lg">${proj.name}</h4>
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${proj.status === 'active' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-600'}">
                      ${proj.status}
                    </span>
                  </div>
                  <p class="text-xs text-slate-500 mt-0.5">${proj.description || 'Independent venture equity ledger'}</p>
                </div>
                <div class="flex items-center space-x-4 text-xs">
                  <div class="text-right">
                    <span class="text-slate-400 block text-[11px]">Distributable Profit</span>
                    <span class="font-bold ${netProfit >= 0 ? 'text-indigo-600' : 'text-rose-600'} text-sm">
                      ${this.currency}${netProfit.toLocaleString(undefined, {minimumFractionDigits: 2})}
                    </span>
                  </div>
                  <div class="text-right border-l border-slate-100 pl-4">
                    <span class="text-slate-400 block text-[11px]">Equity Allocated</span>
                    <span class="font-bold ${totalStake === 100 ? 'text-emerald-600' : 'text-amber-600'} text-sm">
                      ${totalStake}% / 100%
                    </span>
                  </div>
                </div>
              </div>

              <!-- Stakeholders Table -->
              <div class="overflow-x-auto">
                <table class="w-full text-left text-xs text-slate-600">
                  <thead class="bg-slate-50 text-slate-500 uppercase font-semibold text-[11px] border-b border-slate-200">
                    <tr>
                      <th class="py-2.5 px-3">Partner / Stakeholder</th>
                      <th class="py-2.5 px-3">Stake (%)</th>
                      <th class="py-2.5 px-3 text-right">Capital Invested</th>
                      <th class="py-2.5 px-3 text-right">Profit Entitlement</th>
                      <th class="py-2.5 px-3 text-right">Total Paid Out</th>
                      <th class="py-2.5 px-3 text-right">Balance Due</th>
                      <th class="py-2.5 px-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    ${partners.length === 0 ? `
                      <tr>
                        <td colspan="7" class="py-6 text-center text-slate-400">
                          No partners added to this project yet.
                        </td>
                      </tr>
                    ` : partners.map(s => {
                      const entitlement = (netProfit * (s.stakePercentage / 100));
                      const totalPaidOut = this.distributions
                        .filter(d => d.stakeholderId === s.id)
                        .reduce((sum, d) => sum + Number(d.amount), 0);
                      const balanceDue = entitlement - totalPaidOut;

                      return `
                        <tr class="hover:bg-slate-50/80 transition-colors">
                          <td class="py-3 px-3">
                            <span class="font-bold text-slate-900 block">${s.name}</span>
                            <span class="text-[10px] text-slate-400">${s.phone || s.email || 'No contact specified'}</span>
                          </td>
                          <td class="py-3 px-3">
                            <span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                              ${s.stakePercentage}%
                            </span>
                          </td>
                          <td class="py-3 px-3 text-right font-mono font-medium text-slate-700">
                            ${this.currency}${Number(s.capitalInvested || 0).toLocaleString(undefined, {minimumFractionDigits: 2})}
                          </td>
                          <td class="py-3 px-3 text-right font-mono font-bold ${entitlement >= 0 ? 'text-indigo-600' : 'text-rose-600'}">
                            ${this.currency}${entitlement.toLocaleString(undefined, {minimumFractionDigits: 2})}
                          </td>
                          <td class="py-3 px-3 text-right font-mono font-semibold text-emerald-600">
                            ${this.currency}${totalPaidOut.toLocaleString(undefined, {minimumFractionDigits: 2})}
                          </td>
                          <td class="py-3 px-3 text-right font-mono font-bold ${balanceDue > 0 ? 'text-amber-600' : 'text-slate-400'}">
                            ${this.currency}${balanceDue.toLocaleString(undefined, {minimumFractionDigits: 2})}
                          </td>
                          <td class="py-3 px-3 text-center">
                            <div class="flex items-center justify-center space-x-2">
                              <button onclick="window.app && window.app.openQuickPayoutModal('${proj.id}', '${s.id}')" class="px-2 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded text-[11px] font-semibold transition" title="Pay Dividend / Draw">
                                Pay Out
                              </button>
                              <button onclick="window.app && window.app.deleteStakeholder('${s.id}')" class="text-slate-400 hover:text-rose-600 transition p-1" title="Delete">
                                <i class="ph ph-trash text-sm"></i>
                              </button>
                            </div>
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              </div>

              <!-- Quick Add Partner Bar -->
              <div class="pt-2 flex items-center justify-between text-xs">
                <span class="text-slate-400 text-[11px]">Formula: Profit Entitlement = Net Operating Profit × (Stake % / 100)</span>
                <button onclick="window.app && window.app.openAddPartnerForProject('${proj.id}')" class="text-indigo-600 hover:text-indigo-700 font-semibold flex items-center space-x-1">
                  <i class="ph-bold ph-plus"></i>
                  <span>Add Partner to ${proj.name}</span>
                </button>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    // Render Payouts Table
    if (distTableBody) {
      const filteredDists = this.distributions.filter(d => this.currentProjectId === 'ALL' || d.projectId === this.currentProjectId);

      if (filteredDists.length === 0) {
        distTableBody.innerHTML = '';
        emptyDistMsg?.classList.remove('hidden');
      } else {
        emptyDistMsg?.classList.add('hidden');
        distTableBody.innerHTML = filteredDists.map(d => {
          const proj = this.projects.find(p => p.id === d.projectId);
          const partner = this.stakeholders.find(s => s.id === d.stakeholderId);

          return `
            <tr class="hover:bg-slate-50 transition-colors">
              <td class="py-2.5 px-3 font-medium text-slate-900">${d.date}</td>
              <td class="py-2.5 px-3 text-slate-800 font-semibold">${proj ? proj.name : 'Unknown Project'}</td>
              <td class="py-2.5 px-3 text-indigo-700 font-medium">${partner ? partner.name : 'Partner'}</td>
              <td class="py-2.5 px-3">
                <span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  ${d.type.replace('_', ' ')}
                </span>
              </td>
              <td class="py-2.5 px-3 text-slate-500">${d.paymentMode}</td>
              <td class="py-2.5 px-3 text-right font-mono font-bold text-rose-600">
                -${this.currency}${Number(d.amount).toLocaleString(undefined, {minimumFractionDigits: 2})}
              </td>
              <td class="py-2.5 px-3 text-slate-400 truncate max-w-xs">${d.notes || '-'}</td>
              <td class="py-2.5 px-3 text-center">
                <button onclick="window.app && window.app.deleteDistribution('${d.id}')" class="text-slate-400 hover:text-rose-600">
                  <i class="ph ph-trash"></i>
                </button>
              </td>
            </tr>
          `;
        }).join('');
      }
    }
  }

  openAddPartnerForProject(projId) {
    const sel = document.getElementById('stakeholderProjectSelect');
    if (sel) sel.value = projId;
    this.openModal('stakeholderModal');
  }

  openQuickPayoutModal(projId, stakeholderId) {
    const projSel = document.getElementById('payoutProjectSelect');
    if (projSel) {
      projSel.value = projId;
      this.updatePayoutStakeholderOptions(projId);
    }
    const shSel = document.getElementById('payoutStakeholderSelect');
    if (shSel) shSel.value = stakeholderId;
    this.openModal('payoutModal');
  }

  // --- Submissions for Project, Stakeholder, and Payout ---
  async handleProjectSubmit(e) {
    e.preventDefault();
    const project = {
      id: 'proj_' + Date.now(),
      name: document.getElementById('projName').value.trim(),
      description: document.getElementById('projDesc').value.trim(),
      startDate: document.getElementById('projStartDate').value,
      status: document.getElementById('projStatus').value
    };

    this.projects.push(project);
    this.saveData();
    this.populateProjectDropdowns();
    this.closeModal('projectModal');
    e.target.reset();
    document.getElementById('projStartDate').value = new Date().toISOString().split('T')[0];
    this.handleProjectChange(project.id);
    this.showToast(`Project "${project.name}" created!`);

    if (this.db) {
      this.db.from('projects').insert([{
        id: project.id,
        name: project.name,
        description: project.description,
        start_date: project.startDate,
        status: project.status
      }]).then(({ error }) => {
        if (error) console.warn('Supabase project insert error:', error.message);
      });
    }
  }

  async handleStakeholderSubmit(e) {
    e.preventDefault();
    const projId = document.getElementById('stakeholderProjectSelect').value;
    const name = document.getElementById('shName').value.trim();
    const stakePercentage = parseFloat(document.getElementById('shStake').value) || 0;
    const capitalInvested = parseFloat(document.getElementById('shCapital').value) || 0;

    // Validate total stake <= 100%
    const currentTotal = this.stakeholders
      .filter(s => s.projectId === projId)
      .reduce((sum, s) => sum + Number(s.stakePercentage), 0);

    if (currentTotal + stakePercentage > 100.01) {
      this.showToast(`Total stake cannot exceed 100%. Current allocated: ${currentTotal}%`, true);
      return;
    }

    const stakeholder = {
      id: 'sh_' + Date.now(),
      projectId: projId,
      name: name,
      stakePercentage: stakePercentage,
      capitalInvested: capitalInvested,
      phone: document.getElementById('shPhone').value.trim(),
      email: document.getElementById('shEmail').value.trim()
    };

    this.stakeholders.push(stakeholder);
    this.saveData();
    this.closeModal('stakeholderModal');
    e.target.reset();
    const w = document.getElementById('shCapitalWords'); if (w) w.innerText = '';
    this.refreshAll();
    this.showToast(`Partner ${stakeholder.name} (${stakeholder.stakePercentage}%) added!`);

    if (this.db) {
      this.db.from('project_stakeholders').insert([{
        id: stakeholder.id,
        project_id: stakeholder.projectId,
        partner_name: stakeholder.name,
        stake_percentage: stakeholder.stakePercentage,
        capital_invested: stakeholder.capitalInvested,
        phone: stakeholder.phone,
        email: stakeholder.email
      }]).then(({ error }) => {
        if (error) console.warn('Supabase stakeholder insert error:', error.message);
      });
    }
  }

  async handlePayoutSubmit(e) {
    e.preventDefault();
    const projId = document.getElementById('payoutProjectSelect').value;
    const stakeholderId = document.getElementById('payoutStakeholderSelect').value;
    const amount = parseFloat(document.getElementById('payoutAmount').value) || 0;

    if (!stakeholderId) {
      this.showToast('Please select a valid partner.', true);
      return;
    }
    if (amount <= 0) {
      this.showToast('Please enter an amount greater than 0.', true);
      return;
    }

    const distribution = {
      id: 'dist_' + Date.now(),
      projectId: projId,
      stakeholderId: stakeholderId,
      date: document.getElementById('payoutDate').value,
      amount: amount,
      type: document.getElementById('payoutType').value,
      paymentMode: document.getElementById('payoutMode').value,
      notes: document.getElementById('payoutNotes').value.trim()
    };

    this.distributions.push(distribution);
    this.saveData();
    this.closeModal('payoutModal');
    e.target.reset();
    const w = document.getElementById('payoutAmountWords'); if (w) w.innerText = '';
    document.getElementById('payoutDate').value = new Date().toISOString().split('T')[0];
    this.refreshAll();
    this.showToast('Partner profit payout logged!');

    if (this.db) {
      this.db.from('partner_distributions').insert([{
        id: distribution.id,
        project_id: distribution.projectId,
        stakeholder_id: distribution.stakeholderId,
        date: distribution.date,
        amount: distribution.amount,
        type: distribution.type,
        payment_mode: distribution.paymentMode,
        notes: distribution.notes
      }]).then(({ error }) => {
        if (error) console.warn('Supabase distribution insert error:', error.message);
      });
    }
  }

  deleteStakeholder(id) {
    this.stakeholders = this.stakeholders.filter(s => s.id !== id);
    this.distributions = this.distributions.filter(d => d.stakeholderId !== id);
    this.saveData();
    this.refreshAll();
    this.showToast('Stakeholder removed.');

    if (this.db) {
      this.db.from('project_stakeholders').delete().eq('id', id).then(() => {});
    }
  }

  deleteDistribution(id) {
    this.distributions = this.distributions.filter(d => d.id !== id);
    this.saveData();
    this.refreshAll();
    this.showToast('Payout record removed.');

    if (this.db) {
      this.db.from('partner_distributions').delete().eq('id', id).then(() => {});
    }
  }

  // --- Transaction Handling ---
  async handleExpenseSubmit(e) {
    e.preventDefault();
    const expense = {
      id: 'exp_' + Date.now(),
      projectId: document.getElementById('expProjectId').value,
      date: document.getElementById('expDate').value,
      amount: parseFloat(document.getElementById('expAmount').value),
      category: document.getElementById('expCategory').value,
      desc: document.getElementById('expDesc').value.trim(),
      method: document.getElementById('expMethod').value,
      ref: document.getElementById('expRef').value.trim()
    };

    this.expenses.push(expense);
    this.saveData();
    this.closeModal('expenseModal');
    e.target.reset();
    const w1 = document.getElementById('expAmountWords'); if (w1) w1.innerText = '';
    document.getElementById('expDate').value = new Date().toISOString().split('T')[0];
    this.refreshAll();
    this.showToast('Daily expense recorded successfully!');

    if (this.db) {
      this.db.from('expenses').insert([{
        id: expense.id,
        project_id: expense.projectId || null,
        date: expense.date,
        amount: expense.amount,
        category: expense.category,
        description: expense.desc,
        payment_mode: expense.method,
        reference: expense.ref
      }]).then(({ error }) => {
        if (error) console.warn('Supabase expense insert error:', error.message);
      });
    }
  }

  async handleInflowSubmit(e) {
    e.preventDefault();
    const inflow = {
      id: 'inf_' + Date.now(),
      projectId: document.getElementById('inflowProjectId').value,
      date: document.getElementById('inflowDate').value,
      amount: parseFloat(document.getElementById('inflowAmount').value),
      source: document.getElementById('inflowSource').value,
      desc: document.getElementById('inflowDesc').value.trim(),
      method: document.getElementById('inflowMethod').value,
      ref: document.getElementById('inflowRef').value.trim()
    };

    this.inflows.push(inflow);
    this.saveData();
    this.closeModal('inflowModal');
    e.target.reset();
    const w2 = document.getElementById('inflowAmountWords'); if (w2) w2.innerText = '';
    document.getElementById('inflowDate').value = new Date().toISOString().split('T')[0];
    this.refreshAll();
    this.showToast('Revenue added! Cash balance updated.');

    if (this.db) {
      this.db.from('inflows').insert([{
        id: inflow.id,
        project_id: inflow.projectId || null,
        date: inflow.date,
        amount: inflow.amount,
        source: inflow.source,
        description: inflow.desc,
        payment_mode: inflow.method,
        reference: inflow.ref
      }]).then(({ error }) => {
        if (error) console.warn('Supabase inflow insert error:', error.message);
      });
    }
  }

  async handleLoanSubmit(e) {
    e.preventDefault();
    const loan = {
      id: 'loan_' + Date.now(),
      projectId: document.getElementById('loanProjectId').value || null,
      lender: document.getElementById('loanLender').value.trim(),
      type: document.getElementById('loanType').value,
      principal: parseFloat(document.getElementById('loanPrincipal').value),
      rate: parseFloat(document.getElementById('loanRate').value),
      tenureMonths: parseInt(document.getElementById('loanTenure').value, 10),
      date: document.getElementById('loanDate').value,
      logic: document.getElementById('loanInterestLogic').value,
      notes: document.getElementById('loanNotes').value.trim()
    };

    this.loans.push(loan);
    this.saveData();
    this.closeModal('loanModal');
    e.target.reset();
    const w3 = document.getElementById('loanPrincipalWords'); if (w3) w3.innerText = '';
    document.getElementById('loanDate').value = new Date().toISOString().split('T')[0];
    this.refreshAll();
    this.showToast(`Loan from ${loan.lender} credited to account!`);

    if (this.db) {
      this.db.from('loans').insert([{
        id: loan.id,
        project_id: loan.projectId || null,
        lender: loan.lender,
        type: loan.type,
        principal: loan.principal,
        rate: loan.rate,
        tenure_months: loan.tenureMonths,
        date: loan.date,
        logic: loan.logic,
        notes: loan.notes
      }]).then(({ error }) => {
        if (error) console.warn('Supabase loan insert error:', error.message);
      });
    }
  }

  openRepayModal(loanId) {
    const loan = this.loans.find(l => l.id === loanId);
    if (!loan) return;

    const remaining = this.getLoanRemainingPrincipal(loanId);
    document.getElementById('repayLoanId').value = loanId;
    document.getElementById('repayLenderTitle').innerText = loan.lender;
    document.getElementById('repayOutstandingPrincipal').innerText = `${this.currency}${remaining.toLocaleString()}`;

    const p = Number(loan.principal);
    const r = (Number(loan.rate) / 12) / 100;
    const n = Number(loan.tenureMonths);
    const emi = r > 0 ? (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1) : p / n;
    document.getElementById('repayEstimatedEMI').innerText = `${this.currency}${Math.round(emi).toLocaleString()}`;

    const approxMonthInt = Math.round((remaining * (loan.rate / 100)) / 12);
    const approxPrincipal = Math.max(0, Math.min(remaining, Math.round(emi - approxMonthInt)));

    document.getElementById('repayPrincipalPart').value = approxPrincipal;
    document.getElementById('repayInterestPart').value = approxMonthInt;
    this.updateTotalRepaymentSum();
    this.updateAmountWords('repayPrincipalPart', 'repayPrincipalWords');
    this.updateAmountWords('repayInterestPart', 'repayInterestWords');

    this.openModal('repayLoanModal');
  }

  updateTotalRepaymentSum() {
    const p = parseFloat(document.getElementById('repayPrincipalPart')?.value) || 0;
    const i = parseFloat(document.getElementById('repayInterestPart')?.value) || 0;
    const total = p + i;
    const display = document.getElementById('repayTotalDisplay');
    if (display) display.innerText = `-${this.currency}${total.toLocaleString(undefined, {minimumFractionDigits: 2})}`;
    const totalWordsEl = document.getElementById('repayTotalWords');
    if (totalWordsEl) totalWordsEl.innerText = total > 0 ? this.numberToWords(total) : '';
  }

  async handleRepaymentSubmit(e) {
    e.preventDefault();
    const loanId = document.getElementById('repayLoanId').value;
    const loan = this.loans.find(l => l.id === loanId);
    if (!loan) return;

    const principalPart = parseFloat(document.getElementById('repayPrincipalPart').value) || 0;
    const interestPart = parseFloat(document.getElementById('repayInterestPart').value) || 0;

    if (principalPart <= 0 && interestPart <= 0) {
      this.showToast('Please enter principal or interest to pay.', true);
      return;
    }

    const remaining = this.getLoanRemainingPrincipal(loanId);
    if (principalPart > remaining + 0.01) {
      this.showToast(`Principal cannot exceed remaining balance of ${this.currency}${remaining.toLocaleString()}`, true);
      return;
    }

    const repayment = {
      id: 'rep_' + Date.now(),
      loanId: loanId,
      date: document.getElementById('repayDate').value,
      mode: document.getElementById('repayMode').value,
      principalPart: principalPart,
      interestPart: interestPart,
      notes: document.getElementById('repayNotes').value.trim()
    };

    this.repayments.push(repayment);
    this.saveData();
    this.closeModal('repayLoanModal');
    e.target.reset();
    const w4 = document.getElementById('repayPrincipalWords'); if (w4) w4.innerText = ''; 
    const w5 = document.getElementById('repayInterestWords'); if (w5) w5.innerText = ''; 
    const w6 = document.getElementById('repayTotalWords'); if (w6) w6.innerText = '';
    document.getElementById('repayDate').value = new Date().toISOString().split('T')[0];
    this.refreshAll();
    this.showToast('Repayment logged! Debt and account balance updated.');

    if (this.db) {
      this.db.from('repayments').insert([{
        id: repayment.id,
        loan_id: repayment.loanId,
        date: repayment.date,
        principal_paid: repayment.principalPart,
        interest_paid: repayment.interestPart,
        payment_mode: repayment.mode,
        notes: repayment.notes
      }]).then(({ error }) => {
        if (error) console.warn('Supabase repayment insert error:', error.message);
      });
    }
  }

  getLoanRemainingPrincipal(loanId) {
    const loan = this.loans.find(l => l.id === loanId);
    if (!loan) return 0;
    const repaid = this.repayments
      .filter(r => r.loanId === loanId)
      .reduce((sum, r) => sum + Number(r.principalPart), 0);
    return Math.max(0, Number(loan.principal) - repaid);
  }

  getLoanTotalInterestPaid(loanId) {
    return this.repayments
      .filter(r => r.loanId === loanId)
      .reduce((sum, r) => sum + Number(r.interestPart), 0);
  }

  renderDashboardLoanList() {
    const container = document.getElementById('dashboardLoansList');
    if (!container) return;

    const activeLoans = this.loans.filter(l => {
      const matchProject = this.currentProjectId === 'ALL' || l.projectId === this.currentProjectId;
      return matchProject && this.getLoanRemainingPrincipal(l.id) > 0;
    });

    if (activeLoans.length === 0) {
      container.innerHTML = `
        <div class="py-6 text-center text-slate-400 text-xs">
          <i class="ph ph-check-circle text-2xl text-emerald-500 mb-1"></i>
          <p>No active loans in this scope!</p>
        </div>
      `;
      return;
    }

    container.innerHTML = activeLoans.slice(0, 3).map(loan => {
      const remaining = this.getLoanRemainingPrincipal(loan.id);
      const percentPaid = Math.round(((Number(loan.principal) - remaining) / Number(loan.principal)) * 100);
      const proj = this.projects.find(p => p.id === loan.projectId);
      return `
        <div class="p-3 bg-slate-50 border border-slate-100 rounded-xl space-y-2">
          <div class="flex items-center justify-between">
            <div>
              <h5 class="font-bold text-slate-800 text-xs">${loan.lender}</h5>
              <p class="text-[11px] text-slate-500">${proj ? proj.name + ' • ' : ''}${loan.rate}% p.a. • ${loan.tenureMonths} Mo</p>
            </div>
            <div class="text-right">
              <span class="text-xs font-bold text-amber-600">${this.currency}${remaining.toLocaleString()}</span>
              <p class="text-[10px] text-slate-400">of ${this.currency}${Number(loan.principal).toLocaleString()}</p>
            </div>
          </div>
          <div class="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
            <div class="bg-emerald-500 h-full" style="width: ${percentPaid}%"></div>
          </div>
          <div class="flex items-center justify-between text-[10px] text-slate-500 pt-1">
            <span>Repaid: ${percentPaid}%</span>
            <button onclick="window.app && window.app.openRepayModal('${loan.id}')" class="text-indigo-600 font-semibold hover:underline">Repay EMI / Interest</button>
          </div>
        </div>
      `;
    }).join('');
  }

  buildLedgerEntries() {
    const list = [];
    const filterFn = (item) => this.currentProjectId === 'ALL' || item.projectId === this.currentProjectId;

    this.inflows.filter(filterFn).forEach(i => {
      const proj = this.projects.find(p => p.id === i.projectId);
      list.push({
        id: i.id,
        date: i.date,
        projectName: proj ? proj.name : 'General',
        timestamp: new Date(i.date).getTime(),
        title: `${i.source}: ${i.desc}`,
        category: i.source,
        type: 'INFLOW',
        amount: Number(i.amount),
        method: i.method
      });
    });

    this.expenses.filter(filterFn).forEach(e => {
      const proj = this.projects.find(p => p.id === e.projectId);
      list.push({
        id: e.id,
        date: e.date,
        projectName: proj ? proj.name : 'General',
        timestamp: new Date(e.date).getTime(),
        title: `Expense: ${e.desc} (${e.category})`,
        category: e.category,
        type: 'EXPENSE',
        amount: Number(e.amount),
        method: e.method
      });
    });

    this.loans.filter(filterFn).forEach(l => {
      const proj = this.projects.find(p => p.id === l.projectId);
      list.push({
        id: l.id,
        date: l.date,
        projectName: proj ? proj.name : 'Company Loan',
        timestamp: new Date(l.date).getTime(),
        title: `Loan Received: ${l.lender} (${l.type || 'Debt'})`,
        category: 'Loan Inflow',
        type: 'LOAN_BORROWED',
        amount: Number(l.principal),
        method: 'Bank / Direct'
      });
    });

    this.repayments.forEach(r => {
      const loan = this.loans.find(l => l.id === r.loanId);
      if (!loan || (this.currentProjectId !== 'ALL' && loan.projectId !== this.currentProjectId)) return;

      const proj = this.projects.find(p => p.id === loan.projectId);
      const totalOutflow = Number(r.principalPart) + Number(r.interestPart);
      list.push({
        id: r.id,
        date: r.date,
        projectName: proj ? proj.name : 'General',
        timestamp: new Date(r.date).getTime(),
        title: `Loan Repayment to ${loan.lender} (P: ${this.currency}${r.principalPart} + Int: ${this.currency}${r.interestPart})`,
        category: 'Debt Repayment',
        type: 'LOAN_REPAYMENT',
        amount: totalOutflow,
        method: r.mode
      });
    });

    this.distributions.filter(filterFn).forEach(d => {
      const proj = this.projects.find(p => p.id === d.projectId);
      const partner = this.stakeholders.find(s => s.id === d.stakeholderId);
      list.push({
        id: d.id,
        date: d.date,
        projectName: proj ? proj.name : 'General',
        timestamp: new Date(d.date).getTime(),
        title: `Partner Payout to ${partner ? partner.name : 'Stakeholder'} (${d.type.replace('_', ' ')})`,
        category: 'Partner Payout',
        type: 'PAYOUT',
        amount: Number(d.amount),
        method: d.paymentMode
      });
    });

    list.sort((a, b) => a.timestamp - b.timestamp);

    let running = 0;
    list.forEach(item => {
      if (item.type === 'INFLOW' || item.type === 'LOAN_BORROWED') {
        running += item.amount;
      } else {
        running -= item.amount;
      }
      item.runningBalance = running;
    });

    return list.reverse();
  }

  renderCharts() {
    const stats = this.calculateFinancials(this.currentProjectId);

    const barCanvas = document.getElementById('cashflowBarChart');
    if (barCanvas) {
      if (this.chartInstances.cashflow) this.chartInstances.cashflow.destroy();

      const ctx = barCanvas.getContext('2d');
      this.chartInstances.cashflow = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: ['Revenue', 'Loans Inflow', 'Expenses', 'Principal Paid', 'Interest Paid', 'Partner Payouts'],
          datasets: [{
            data: [
              stats.totalRevenue,
              stats.totalLoanBorrowed,
              stats.totalExpenses,
              stats.totalPrincipalRepaid,
              stats.totalInterestPaid,
              stats.totalPayoutsDisbursed
            ],
            backgroundColor: ['#10b981', '#6366f1', '#f43f5e', '#f59e0b', '#a855f7', '#06b6d4'],
            borderRadius: 8,
            barThickness: 24
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (context) => ` ${this.currency}${context.raw.toLocaleString()}`
              }
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              grid: { color: '#f1f5f9' },
              ticks: {
                font: { size: 10 },
                callback: (value) => `${this.currency}${value >= 1000 ? (value/1000) + 'k' : value}`
              }
            },
            x: {
              grid: { display: false },
              ticks: { font: { size: 10 } }
            }
          }
        }
      });
    }

    const catCanvas = document.getElementById('categoryDoughnutChart');
    if (catCanvas) {
      if (this.chartInstances.category) this.chartInstances.category.destroy();

      const catMap = {};
      this.expenses
        .filter(e => this.currentProjectId === 'ALL' || e.projectId === this.currentProjectId)
        .forEach(e => {
          catMap[e.category] = (catMap[e.category] || 0) + Number(e.amount);
        });

      const categories = Object.keys(catMap);
      const amounts = Object.values(catMap);
      const defaultColors = ['#f43f5e', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#64748b'];

      if (categories.length === 0) {
        categories.push('No Expenses');
        amounts.push(1);
      }

      const ctxCat = catCanvas.getContext('2d');
      this.chartInstances.category = new Chart(ctxCat, {
        type: 'doughnut',
        data: {
          labels: categories,
          datasets: [{
            data: amounts,
            backgroundColor: defaultColors.slice(0, categories.length),
            borderWidth: 2,
            borderColor: '#ffffff'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '72%',
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (context) => ` ${context.label}: ${this.currency}${Number(context.raw).toLocaleString()}`
              }
            }
          }
        }
      });

      const legendEl = document.getElementById('categoryLegend');
      if (legendEl) {
        legendEl.innerHTML = categories.map((cat, idx) => {
          if (cat === 'No Expenses') return '';
          const amt = catMap[cat] || 0;
          const color = defaultColors[idx % defaultColors.length];
          return `
            <div class="flex items-center justify-between text-[11px] text-slate-600">
              <div class="flex items-center space-x-1.5 truncate">
                <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background-color: ${color}"></span>
                <span class="truncate">${cat}</span>
              </div>
              <span class="font-semibold">${this.currency}${amt.toLocaleString()}</span>
            </div>
          `;
        }).join('');
      }
    }
  }

  renderExpenses() {
    const tbody = document.getElementById('expensesTableBody');
    const emptyMsg = document.getElementById('emptyExpenseMsg');
    if (!tbody) return;

    const query = (document.getElementById('expenseSearchInput')?.value || '').toLowerCase();
    const projFilter = document.getElementById('expenseProjectFilter')?.value || this.currentProjectId;
    const catFilter = document.getElementById('expenseCategoryFilter')?.value || 'ALL';
    const methodFilter = document.getElementById('expenseMethodFilter')?.value || 'ALL';

    const filtered = this.expenses.filter(item => {
      const matchesProj = projFilter === 'ALL' || item.projectId === projFilter;
      const matchesQuery = item.desc.toLowerCase().includes(query) || (item.ref || '').toLowerCase().includes(query);
      const matchesCat = catFilter === 'ALL' || item.category === catFilter;
      const matchesMethod = methodFilter === 'ALL' || item.method === methodFilter;
      return matchesProj && matchesQuery && matchesCat && matchesMethod;
    }).sort((a, b) => new Date(b.date) - new Date(a.date));

    if (filtered.length === 0) {
      tbody.innerHTML = '';
      emptyMsg?.classList.remove('hidden');
      return;
    }

    emptyMsg?.classList.add('hidden');
    tbody.innerHTML = filtered.map(item => {
      const proj = this.projects.find(p => p.id === item.projectId);
      return `
        <tr class="hover:bg-slate-50/80 transition-colors">
          <td class="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">${item.date}</td>
          <td class="py-3 px-4">
            <span class="font-semibold text-slate-800">${proj ? proj.name : 'General'}</span>
          </td>
          <td class="py-3 px-4">
            <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200">
              ${item.category}
            </span>
          </td>
          <td class="py-3 px-4 font-medium text-slate-800">${item.desc}</td>
          <td class="py-3 px-4 text-slate-500">${item.method}</td>
          <td class="py-3 px-4 font-mono text-slate-400 text-[11px]">${item.ref || '-'}</td>
          <td class="py-3 px-4 text-right font-bold text-rose-600 whitespace-nowrap font-mono">
            -${this.currency}${Number(item.amount).toLocaleString(undefined, {minimumFractionDigits: 2})}
          </td>
          <td class="py-3 px-4 text-center">
            <button onclick="window.app && window.app.deleteExpense('${item.id}')" class="text-slate-400 hover:text-rose-600 transition p-1" title="Delete">
              <i class="ph ph-trash text-base"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  renderInflows() {
    const tbody = document.getElementById('inflowsTableBody');
    const emptyMsg = document.getElementById('emptyInflowMsg');
    if (!tbody) return;

    const list = this.inflows
      .filter(i => this.currentProjectId === 'ALL' || i.projectId === this.currentProjectId)
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    if (list.length === 0) {
      tbody.innerHTML = '';
      emptyMsg?.classList.remove('hidden');
      return;
    }

    emptyMsg?.classList.add('hidden');
    tbody.innerHTML = list.map(item => {
      const proj = this.projects.find(p => p.id === item.projectId);
      return `
        <tr class="hover:bg-slate-50/80 transition-colors">
          <td class="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">${item.date}</td>
          <td class="py-3 px-4 font-semibold text-slate-800">${proj ? proj.name : 'General'}</td>
          <td class="py-3 px-4">
            <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              ${item.source}
            </span>
          </td>
          <td class="py-3 px-4 font-medium text-slate-800">${item.desc}</td>
          <td class="py-3 px-4 text-slate-500">${item.method}</td>
          <td class="py-3 px-4 font-mono text-slate-400 text-[11px]">${item.ref || '-'}</td>
          <td class="py-3 px-4 text-right font-bold text-emerald-600 whitespace-nowrap font-mono">
            +${this.currency}${Number(item.amount).toLocaleString(undefined, {minimumFractionDigits: 2})}
          </td>
          <td class="py-3 px-4 text-center">
            <button onclick="window.app && window.app.deleteInflow('${item.id}')" class="text-slate-400 hover:text-rose-600 transition p-1" title="Delete">
              <i class="ph ph-trash text-base"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  renderLoans() {
    const container = document.getElementById('loansCardsContainer');
    const repBody = document.getElementById('repaymentsTableBody');
    const emptyRepMsg = document.getElementById('emptyRepaymentMsg');
    if (!container) return;

    const filteredLoans = this.loans.filter(l => this.currentProjectId === 'ALL' || l.projectId === this.currentProjectId);

    if (filteredLoans.length === 0) {
      container.innerHTML = `
        <div class="col-span-full py-12 text-center bg-white rounded-2xl border border-slate-200 text-slate-400">
          <i class="ph ph-bank text-4xl mb-2 text-slate-300"></i>
          <p>No loans registered in this workspace.</p>
          <button onclick="window.app && window.app.openModal('loanModal')" class="mt-3 inline-flex items-center space-x-1.5 text-xs text-indigo-600 font-bold hover:underline">
            <span>+ Borrow Loan</span>
          </button>
        </div>
      `;
    } else {
      container.innerHTML = filteredLoans.map(loan => {
        const remaining = this.getLoanRemainingPrincipal(loan.id);
        const totalRepaidPrincipal = Number(loan.principal) - remaining;
        const interestPaid = this.getLoanTotalInterestPaid(loan.id);
        const isFullyPaid = remaining <= 0;
        const percentRepaid = Math.min(100, Math.round((totalRepaidPrincipal / Number(loan.principal)) * 100));
        const proj = this.projects.find(p => p.id === loan.projectId);

        const p = Number(loan.principal);
        const r = (Number(loan.rate) / 12) / 100;
        const n = Number(loan.tenureMonths);
        const estEMI = r > 0 ? (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1) : p / n;

        return `
          <div class="bg-white rounded-2xl p-5 border ${isFullyPaid ? 'border-emerald-200 bg-emerald-50/20' : 'border-slate-200'} shadow-sm space-y-4 flex flex-col justify-between">
            <div>
              <div class="flex items-start justify-between">
                <div>
                  <div class="flex items-center space-x-1.5">
                    <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">${loan.type || 'Commercial Debt'}</span>
                    ${proj ? `<span class="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded font-semibold">${proj.name}</span>` : ''}
                  </div>
                  <h4 class="font-bold text-slate-900 text-base leading-tight mt-0.5">${loan.lender}</h4>
                  <p class="text-xs text-slate-500 mt-0.5">Disbursed on ${loan.date}</p>
                </div>
                <span class="px-2.5 py-1 rounded-full text-[10px] font-bold ${isFullyPaid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">
                  ${isFullyPaid ? 'PAID OFF' : 'ACTIVE LOAN'}
                </span>
              </div>

              <div class="grid grid-cols-2 gap-3 mt-4 pt-3 border-t border-slate-100 text-xs">
                <div>
                  <span class="text-slate-400 text-[11px]">Original Principal</span>
                  <p class="font-bold text-slate-800">${this.currency}${Number(loan.principal).toLocaleString()}</p>
                </div>
                <div>
                  <span class="text-slate-400 text-[11px]">Interest Rate</span>
                  <p class="font-bold text-indigo-600">${loan.rate}% per year</p>
                </div>
                <div>
                  <span class="text-slate-400 text-[11px]">Tenure</span>
                  <p class="font-bold text-slate-800">${loan.tenureMonths} Months</p>
                </div>
                <div>
                  <span class="text-slate-400 text-[11px]">Est. Monthly EMI</span>
                  <p class="font-bold text-purple-600">${this.currency}${Math.round(estEMI).toLocaleString()}</p>
                </div>
              </div>

              <div class="mt-4 space-y-1">
                <div class="flex justify-between text-xs">
                  <span class="text-slate-500">Remaining Balance</span>
                  <span class="font-extrabold text-amber-600">${this.currency}${remaining.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                </div>
                <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                  <div class="bg-indigo-600 h-full transition-all duration-300" style="width: ${percentRepaid}%"></div>
                </div>
                <div class="flex justify-between text-[10px] text-slate-400">
                  <span>Repaid: ${this.currency}${totalRepaidPrincipal.toLocaleString()} (${percentRepaid}%)</span>
                  <span>Interest Paid: ${this.currency}${interestPaid.toLocaleString()}</span>
                </div>
              </div>
            </div>

            <div class="pt-3 border-t border-slate-100 flex items-center justify-between">
              <button onclick="window.app && window.app.deleteLoan('${loan.id}')" class="text-slate-400 hover:text-rose-600 text-xs flex items-center space-x-1" title="Delete record">
                <i class="ph ph-trash"></i>
                <span>Delete</span>
              </button>
              ${!isFullyPaid ? `
                <button onclick="window.app && window.app.openRepayModal('${loan.id}')" class="inline-flex items-center space-x-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-bold px-3 py-1.5 rounded-lg text-xs transition">
                  <i class="ph ph-hand-deposit"></i>
                  <span>Pay Installment</span>
                </button>
              ` : `
                <span class="text-xs text-emerald-600 font-semibold flex items-center">
                  <i class="ph ph-check mr-1"></i> Settled
                </span>
              `}
            </div>
          </div>
        `;
      }).join('');
    }

    if (repBody) {
      const filteredReps = this.repayments.filter(r => {
        if (this.currentProjectId === 'ALL') return true;
        const loan = this.loans.find(l => l.id === r.loanId);
        return loan && loan.projectId === this.currentProjectId;
      }).sort((a, b) => new Date(b.date) - new Date(a.date));

      if (filteredReps.length === 0) {
        repBody.innerHTML = '';
        emptyRepMsg?.classList.remove('hidden');
      } else {
        emptyRepMsg?.classList.add('hidden');
        repBody.innerHTML = filteredReps.map(r => {
          const loanObj = this.loans.find(l => l.id === r.loanId);
          const lender = loanObj ? loanObj.lender : 'Unknown Lender';
          const proj = loanObj ? this.projects.find(p => p.id === loanObj.projectId) : null;
          const total = Number(r.principalPart) + Number(r.interestPart);

          return `
            <tr class="hover:bg-slate-50 transition-colors">
              <td class="py-2.5 px-3 font-medium text-slate-900">${r.date}</td>
              <td class="py-2.5 px-3 text-slate-700 font-semibold">${proj ? proj.name : 'General'}</td>
              <td class="py-2.5 px-3 font-semibold text-slate-800">${lender}</td>
              <td class="py-2.5 px-3 text-indigo-600 font-mono font-medium">${this.currency}${Number(r.principalPart).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
              <td class="py-2.5 px-3 text-purple-600 font-mono font-medium">${this.currency}${Number(r.interestPart).toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
              <td class="py-2.5 px-3 font-bold text-rose-600 font-mono">${this.currency}${total.toLocaleString(undefined, {minimumFractionDigits: 2})}</td>
              <td class="py-2.5 px-3 text-slate-500">${r.mode}</td>
              <td class="py-2.5 px-3 text-slate-400 truncate max-w-xs">${r.notes || '-'}</td>
              <td class="py-2.5 px-3 text-center">
                <button onclick="window.app && window.app.deleteRepayment('${r.id}')" class="text-slate-400 hover:text-rose-600">
                  <i class="ph ph-trash"></i>
                </button>
              </td>
            </tr>
          `;
        }).join('');
      }
    }
  }

  renderLedger() {
    const tbody = document.getElementById('ledgerTableBody');
    if (!tbody) return;

    let entries = this.buildLedgerEntries();

    if (this.currentLedgerFilter === 'INFLOW') {
      entries = entries.filter(e => e.type === 'INFLOW');
    } else if (this.currentLedgerFilter === 'OUTFLOW') {
      entries = entries.filter(e => e.type === 'EXPENSE');
    } else if (this.currentLedgerFilter === 'LOAN') {
      entries = entries.filter(e => e.type === 'LOAN_BORROWED' || e.type === 'LOAN_REPAYMENT');
    } else if (this.currentLedgerFilter === 'PAYOUT') {
      entries = entries.filter(e => e.type === 'PAYOUT');
    }

    if (entries.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="py-12 text-center text-slate-400">No ledger entries found for selected filter.</td></tr>`;
      return;
    }

    tbody.innerHTML = entries.map(item => {
      const isCredit = item.type === 'INFLOW' || item.type === 'LOAN_BORROWED';
      const typeBadge = {
        INFLOW: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        EXPENSE: 'bg-rose-50 text-rose-700 border-rose-200',
        LOAN_BORROWED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
        LOAN_REPAYMENT: 'bg-purple-50 text-purple-700 border-purple-200',
        PAYOUT: 'bg-amber-50 text-amber-700 border-amber-200'
      }[item.type] || 'bg-slate-50 text-slate-700 border-slate-200';

      return `
        <tr class="hover:bg-slate-50 transition-colors">
          <td class="py-3 px-4 whitespace-nowrap text-slate-700">${item.date}</td>
          <td class="py-3 px-4 font-sans font-semibold text-slate-800">${item.projectName}</td>
          <td class="py-3 px-4 font-sans font-medium text-slate-800">${item.title}</td>
          <td class="py-3 px-4">
            <span class="inline-flex px-2 py-0.5 rounded text-[10px] font-sans font-bold border ${typeBadge}">
              ${item.type.replace('_', ' ')}
            </span>
          </td>
          <td class="py-3 px-4 font-sans text-slate-500">${item.method || '-'}</td>
          <td class="py-3 px-4 text-right text-rose-600 font-bold">
            ${!isCredit ? `-${this.currency}${item.amount.toLocaleString(undefined, {minimumFractionDigits: 2})}` : '-'}
          </td>
          <td class="py-3 px-4 text-right text-emerald-600 font-bold">
            ${isCredit ? `+${this.currency}${item.amount.toLocaleString(undefined, {minimumFractionDigits: 2})}` : '-'}
          </td>
          <td class="py-3 px-4 text-right font-bold text-slate-900 bg-slate-50/50">
            ${this.currency}${item.runningBalance.toLocaleString(undefined, {minimumFractionDigits: 2})}
          </td>
        </tr>
      `;
    }).join('');
  }

  setLedgerFilter(filterType) {
    this.currentLedgerFilter = filterType;
    document.querySelectorAll('.ledger-filter-btn').forEach(btn => {
      if (btn.getAttribute('data-filter') === filterType) {
        btn.className = 'ledger-filter-btn px-2.5 py-1 rounded-md bg-slate-800 text-white font-medium';
      } else {
        btn.className = 'ledger-filter-btn px-2.5 py-1 rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 font-medium';
      }
    });
    this.renderLedger();
  }

  deleteExpense(id) {
    this.expenses = this.expenses.filter(e => e.id !== id);
    this.saveData();
    this.refreshAll();
    this.showToast('Expense removed.');
    if (this.db) this.db.from('expenses').delete().eq('id', id).then(() => {});
  }

  deleteInflow(id) {
    this.inflows = this.inflows.filter(i => i.id !== id);
    this.saveData();
    this.refreshAll();
    this.showToast('Revenue entry removed.');
    if (this.db) this.db.from('inflows').delete().eq('id', id).then(() => {});
  }

  deleteLoan(loanId) {
    this.loans = this.loans.filter(l => l.id !== loanId);
    this.repayments = this.repayments.filter(r => r.loanId !== loanId);
    this.saveData();
    this.refreshAll();
    this.showToast('Loan and repayment records deleted.');
    if (this.db) this.db.from('loans').delete().eq('id', loanId).then(() => {});
  }

  deleteRepayment(repId) {
    this.repayments = this.repayments.filter(r => r.id !== repId);
    this.saveData();
    this.refreshAll();
    this.showToast('Repayment installment deleted.');
    if (this.db) this.db.from('repayments').delete().eq('id', repId).then(() => {});
  }

  runCalculator() {
    const principal = parseFloat(document.getElementById('calcPrincipal')?.value) || 0;
    const annualRate = parseFloat(document.getElementById('calcRate')?.value) || 0;
    const tenureMonths = parseInt(document.getElementById('calcTenure')?.value) || 1;
    const type = document.getElementById('calcType')?.value || 'emi';

    let monthlyPay = 0;
    let totalInterest = 0;
    let totalPayment = 0;

    if (type === 'emi') {
      const monthlyRate = (annualRate / 12) / 100;
      if (monthlyRate > 0) {
        monthlyPay = (principal * monthlyRate * Math.pow(1 + monthlyRate, tenureMonths)) / (Math.pow(1 + monthlyRate, tenureMonths) - 1);
        totalPayment = monthlyPay * tenureMonths;
        totalInterest = Math.max(0, totalPayment - principal);
      } else {
        monthlyPay = principal / tenureMonths;
        totalPayment = principal;
        totalInterest = 0;
      }
    } else if (type === 'flat') {
      totalInterest = principal * (annualRate / 100) * (tenureMonths / 12);
      totalPayment = principal + totalInterest;
      monthlyPay = totalPayment / tenureMonths;
    } else {
      const monthlyInterest = (principal * (annualRate / 100)) / 12;
      monthlyPay = monthlyInterest;
      totalInterest = monthlyInterest * tenureMonths;
      totalPayment = principal + totalInterest;
    }

    const resMonthly = document.getElementById('resMonthlyPayment');
    if (resMonthly) resMonthly.innerText = `${this.currency}${Math.round(monthlyPay).toLocaleString()}`;

    const resInterest = document.getElementById('resTotalInterest');
    if (resInterest) resInterest.innerText = `${this.currency}${Math.round(totalInterest).toLocaleString()}`;

    const resPayment = document.getElementById('resTotalPayment');
    if (resPayment) resPayment.innerText = `${this.currency}${Math.round(totalPayment).toLocaleString()}`;

    const safeTotal = totalPayment > 0 ? totalPayment : 1;
    const principalRatio = Math.round((principal / safeTotal) * 100);
    const interestRatio = Math.max(0, 100 - principalRatio);

    const barP = document.getElementById('barPrincipal');
    if (barP) barP.style.width = `${principalRatio}%`;

    const barI = document.getElementById('barInterest');
    if (barI) barI.style.width = `${interestRatio}%`;

    const barPLabel = document.getElementById('barPrincipalLabel');
    if (barPLabel) barPLabel.innerText = `${this.currency}${Math.round(principal).toLocaleString()} (${principalRatio}%)`;

    const barILabel = document.getElementById('barInterestLabel');
    if (barILabel) barILabel.innerText = `${this.currency}${Math.round(totalInterest).toLocaleString()} (${interestRatio}%)`;
    this.updateAmountWords('calcPrincipal', 'calcPrincipalWords');
  }

  bindEvents() {
    const mobileBtn = document.getElementById('mobileMenuBtn');
    const closeSidebarBtn = document.getElementById('closeSidebarBtn');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('drawerOverlay');

    const toggleDrawer = (open) => {
      if (open) {
        sidebar.classList.remove('-translate-x-full');
        overlay.classList.remove('hidden');
      } else {
        sidebar.classList.add('-translate-x-full');
        overlay.classList.add('hidden');
      }
    };

    if (mobileBtn) mobileBtn.addEventListener('click', () => toggleDrawer(true));
    if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', () => toggleDrawer(false));
    if (overlay) overlay.addEventListener('click', () => toggleDrawer(false));

    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const section = item.getAttribute('data-section');
        this.showSection(section);
        if (window.innerWidth < 768) toggleDrawer(false);
      });
    });

    const currSelector = document.getElementById('currencySelector');
    if (currSelector) {
      currSelector.addEventListener('change', (e) => {
        this.currency = e.target.value;
        this.saveData();
        this.refreshAll();
        ['expAmount', 'inflowAmount', 'loanPrincipal', 'repayPrincipalPart', 'repayInterestPart', 'calcPrincipal', 'shCapital', 'payoutAmount'].forEach(id => {
          this.updateAmountWords(id, id + 'Words');
        });
        this.showToast(`Operating currency switched to ${this.currency}`);
      });
    }
  }

  showSection(sectionId) {
    document.querySelectorAll('.nav-item').forEach(item => {
      const sec = item.getAttribute('data-section');
      if (sec === sectionId) {
        item.className = 'nav-item flex items-center space-x-3 px-3.5 py-2.5 rounded-xl font-medium text-sm transition-colors bg-emerald-600/10 text-emerald-400';
      } else {
        item.className = 'nav-item flex items-center space-x-3 px-3.5 py-2.5 rounded-xl font-medium text-sm transition-colors text-slate-400 hover:bg-slate-800 hover:text-white';
      }
    });

    ['dashboard', 'stakeholders', 'expenses', 'inflows', 'loans', 'ledger', 'calculator'].forEach(sec => {
      const el = document.getElementById(`section-${sec}`);
      if (el) {
        if (sec === sectionId) el.classList.remove('hidden');
        else el.classList.add('hidden');
      }
    });

    const titles = {
      dashboard: { t: 'Financial Dashboard', sub: 'Live operational liquidity, debt obligations, and profit margins' },
      stakeholders: { t: 'Stakeholders & Equity Management', sub: 'Partner shares (%), profit entitlements, and dividend distributions' },
      expenses: { t: 'Daily Business Expenses', sub: 'Categorized daily spending, supplier payments, and overheads' },
      inflows: { t: 'Revenue & Capital Inflows', sub: 'Customer sales deposits, invoice settlements, and injections' },
      loans: { t: 'Borrowings & Debt Management', sub: 'Active business loans, interest accrual, and repayment schedules' },
      ledger: { t: 'Audit Trail & Cash Book', sub: 'Running balance history with chronological ledger entries' },
      calculator: { t: 'Commercial Loan & EMI Calculator', sub: 'Estimate business loan costs, interest, and monthly installments' }
    };

    if (titles[sectionId]) {
      document.getElementById('pageTitle').innerText = titles[sectionId].t;
      document.getElementById('pageSubtitle').innerText = titles[sectionId].sub;
    }

    if (sectionId === 'stakeholders') this.renderStakeholdersSection();
    if (sectionId === 'expenses') this.renderExpenses();
    if (sectionId === 'inflows') this.renderInflows();
    if (sectionId === 'loans') this.renderLoans();
    if (sectionId === 'ledger') this.renderLedger();
    if (sectionId === 'dashboard') this.renderCharts();
  }

  // --- Supabase Cloud Sync ---
  async syncFromSupabase() {
    if (!this.db) return;
    this.updateCloudStatus(false, 'Syncing...');

    try {
      const [projRes, shRes, distRes, expRes, infRes, loanRes, repRes] = await Promise.all([
        this.db.from('projects').select('*').order('created_at', { ascending: false }),
        this.db.from('project_stakeholders').select('*').order('created_at', { ascending: true }),
        this.db.from('partner_distributions').select('*').order('date', { ascending: false }),
        this.db.from('expenses').select('*').order('date', { ascending: false }),
        this.db.from('inflows').select('*').order('date', { ascending: false }),
        this.db.from('loans').select('*').order('date', { ascending: false }),
        this.db.from('repayments').select('*').order('date', { ascending: false })
      ]);

      let hasSupabaseData = false;

      if (!projRes.error && projRes.data && projRes.data.length > 0) {
        this.projects = projRes.data.map(p => ({
          id: p.id,
          name: p.name,
          description: p.description || '',
          startDate: p.start_date || '',
          status: p.status || 'active'
        }));
        hasSupabaseData = true;
      }

      if (!shRes.error && shRes.data && shRes.data.length > 0) {
        this.stakeholders = shRes.data.map(s => ({
          id: s.id,
          projectId: s.project_id,
          name: s.partner_name,
          stakePercentage: parseFloat(s.stake_percentage),
          capitalInvested: parseFloat(s.capital_invested || 0),
          phone: s.phone || '',
          email: s.email || ''
        }));
        hasSupabaseData = true;
      }

      if (!distRes.error && distRes.data && distRes.data.length > 0) {
        this.distributions = distRes.data.map(d => ({
          id: d.id,
          projectId: d.project_id,
          stakeholderId: d.stakeholder_id,
          date: d.date,
          amount: parseFloat(d.amount),
          type: d.type || 'profit_payout',
          paymentMode: d.payment_mode || 'Bank Transfer',
          notes: d.notes || ''
        }));
        hasSupabaseData = true;
      }

      if (!loanRes.error && loanRes.data && loanRes.data.length > 0) {
        this.loans = loanRes.data.map(l => ({
          id: l.id,
          projectId: l.project_id || null,
          lender: l.lender,
          type: l.type,
          principal: parseFloat(l.principal),
          rate: parseFloat(l.rate),
          tenureMonths: parseInt(l.tenure_months, 10),
          date: l.date,
          logic: l.logic || 'reducing',
          notes: l.notes || ''
        }));
        hasSupabaseData = true;
      }

      if (!expRes.error && expRes.data && expRes.data.length > 0) {
        this.expenses = expRes.data.map(e => ({
          id: e.id,
          projectId: e.project_id || null,
          date: e.date,
          amount: parseFloat(e.amount),
          category: e.category,
          desc: e.description,
          method: e.payment_mode || 'Bank Transfer',
          ref: e.reference || ''
        }));
        hasSupabaseData = true;
      }

      if (!infRes.error && infRes.data && infRes.data.length > 0) {
        this.inflows = infRes.data.map(i => ({
          id: i.id,
          projectId: i.project_id || null,
          date: i.date,
          amount: parseFloat(i.amount),
          source: i.source,
          desc: i.description,
          method: i.payment_mode || 'Bank Transfer',
          ref: i.reference || ''
        }));
        hasSupabaseData = true;
      }

      if (!repRes.error && repRes.data && repRes.data.length > 0) {
        this.repayments = repRes.data.map(r => ({
          id: r.id,
          loanId: r.loan_id,
          date: r.date,
          principalPart: parseFloat(r.principal_paid) || 0,
          interestPart: parseFloat(r.interest_paid) || 0,
          mode: r.payment_mode || 'Bank Transfer',
          notes: r.notes || ''
        }));
        hasSupabaseData = true;
      }

      if (hasSupabaseData) {
        this.saveData();
        this.populateProjectDropdowns();
        this.refreshAll();
        this.updateCloudStatus(true, 'Cloud Synced');
      } else {
        this.updateCloudStatus(true, 'Cloud Ready (Empty)');
      }
    } catch (err) {
      console.warn('Supabase fetch failed:', err);
      this.updateCloudStatus(false, 'Local Offline');
    }
  }

  async pushLocalToSupabase() {
    if (!this.db) {
      this.showToast('Supabase client not initialized', true);
      return;
    }

    this.showToast('Pushing multi-project data to Supabase...');

    try {
      // 1. Projects
      if (this.projects.length > 0) {
        const pRows = this.projects.map(p => ({
          id: p.id,
          name: p.name,
          description: p.description,
          start_date: p.startDate,
          status: p.status
        }));
        const { error: pErr } = await this.db.from('projects').upsert(pRows);
        if (pErr) throw pErr;
      }

      // 2. Stakeholders
      if (this.stakeholders.length > 0) {
        const shRows = this.stakeholders.map(s => ({
          id: s.id,
          project_id: s.projectId,
          partner_name: s.name,
          stake_percentage: s.stakePercentage,
          capital_invested: s.capitalInvested,
          phone: s.phone,
          email: s.email
        }));
        const { error: shErr } = await this.db.from('project_stakeholders').upsert(shRows);
        if (shErr) throw shErr;
      }

      // 3. Loans
      if (this.loans.length > 0) {
        const loanRows = this.loans.map(l => ({
          id: l.id,
          project_id: l.projectId || null,
          lender: l.lender,
          type: l.type,
          principal: l.principal,
          rate: l.rate,
          tenure_months: l.tenureMonths,
          date: l.date,
          logic: l.logic,
          notes: l.notes
        }));
        const { error: lErr } = await this.db.from('loans').upsert(loanRows);
        if (lErr) throw lErr;
      }

      // 4. Inflows
      if (this.inflows.length > 0) {
        const inflowRows = this.inflows.map(i => ({
          id: i.id,
          project_id: i.projectId || null,
          date: i.date,
          amount: i.amount,
          source: i.source,
          description: i.desc,
          payment_mode: i.method,
          reference: i.ref
        }));
        const { error: iErr } = await this.db.from('inflows').upsert(inflowRows);
        if (iErr) throw iErr;
      }

      // 5. Expenses
      if (this.expenses.length > 0) {
        const expRows = this.expenses.map(e => ({
          id: e.id,
          project_id: e.projectId || null,
          date: e.date,
          amount: e.amount,
          category: e.category,
          description: e.desc,
          payment_mode: e.method,
          reference: e.ref
        }));
        const { error: eErr } = await this.db.from('expenses').upsert(expRows);
        if (eErr) throw eErr;
      }

      // 6. Repayments
      if (this.repayments.length > 0) {
        const repRows = this.repayments.map(r => ({
          id: r.id,
          loan_id: r.loanId,
          date: r.date,
          principal_paid: r.principalPart,
          interest_paid: r.interestPart,
          payment_mode: r.mode,
          notes: r.notes
        }));
        const { error: rErr } = await this.db.from('repayments').upsert(repRows);
        if (rErr) throw rErr;
      }

      // 7. Distributions
      if (this.distributions.length > 0) {
        const distRows = this.distributions.map(d => ({
          id: d.id,
          project_id: d.projectId,
          stakeholder_id: d.stakeholderId,
          date: d.date,
          amount: d.amount,
          type: d.type,
          payment_mode: d.paymentMode,
          notes: d.notes
        }));
        const { error: dErr } = await this.db.from('partner_distributions').upsert(distRows);
        if (dErr) throw dErr;
      }

      this.updateCloudStatus(true, 'Cloud Synced');
      this.showToast('All multi-project data pushed to Supabase!');
    } catch (err) {
      console.error('Push error:', err);
      this.showToast('Error syncing with Supabase: ' + err.message, true);
    }
  }

  // --- Storage & Demo Data ---
  saveData() {
    try {
      const state = {
        projects: this.projects,
        stakeholders: this.stakeholders,
        distributions: this.distributions,
        expenses: this.expenses,
        inflows: this.inflows,
        loans: this.loans,
        repayments: this.repayments,
        currency: this.currency,
        currentProjectId: this.currentProjectId
      };
      window._accuBizState = state;
      try {
        localStorage.setItem('accubiz_data', JSON.stringify(state));
      } catch (e) {}
    } catch (err) {
      console.warn('Storage save fallback', err);
    }
  }

  loadData() {
    let loaded = null;
    try {
      const raw = localStorage.getItem('accubiz_data');
      if (raw) loaded = JSON.parse(raw);
    } catch (e) {
      loaded = window._accuBizState;
    }

    if (loaded && loaded.projects?.length) {
      this.projects = loaded.projects || [];
      this.stakeholders = loaded.stakeholders || [];
      this.distributions = loaded.distributions || [];
      this.expenses = loaded.expenses || [];
      this.inflows = loaded.inflows || [];
      this.loans = loaded.loans || [];
      this.repayments = loaded.repayments || [];
      this.currency = loaded.currency || '₹';
      this.currentProjectId = loaded.currentProjectId || 'ALL';
      const sel = document.getElementById('currencySelector');
      if (sel) sel.value = this.currency;
    } else {
      this.seedInitialBusinessData();
    }
  }

  resetDemoData() {
    this.seedInitialBusinessData();
    this.saveData();
    this.populateProjectDropdowns();
    this.refreshAll();
    this.showToast('Multi-project demo workspace reloaded!');
  }

  seedInitialBusinessData() {
    const today = new Date();
    const d = (daysAgo) => {
      const target = new Date(today);
      target.setDate(target.getDate() - daysAgo);
      return target.toISOString().split('T')[0];
    };

    this.currency = '₹';
    this.currentProjectId = 'ALL';

    // 1. Projects
    this.projects = [
      {
        id: 'proj_olivetree',
        name: 'Olivetree Interiors',
        description: 'Residential & commercial interior design execution',
        startDate: d(90),
        status: 'active'
      },
      {
        id: 'proj_angel',
        name: 'Angel Jewellery',
        description: 'Retail & online e-commerce jewelry venture',
        startDate: d(60),
        status: 'active'
      },
      {
        id: 'proj_bsk',
        name: 'BSK Icon Real Estate',
        description: 'Apartment development joint development agreement',
        startDate: d(40),
        status: 'active'
      }
    ];

    // 2. Stakeholders with Equity % per Project
    this.stakeholders = [
      // Olivetree Interiors (60% Guru / 40% Partner Narayana)
      {
        id: 'sh_1',
        projectId: 'proj_olivetree',
        name: 'Gurubrahmam G.',
        stakePercentage: 60.0,
        capitalInvested: 500000,
        phone: '+91 98765 43210',
        email: 'guru@olivetree.com'
      },
      {
        id: 'sh_2',
        projectId: 'proj_olivetree',
        name: 'Narayana Gundareddy',
        stakePercentage: 40.0,
        capitalInvested: 350000,
        phone: '+91 98765 12345',
        email: 'narayana@example.com'
      },
      // Angel Jewellery (50% Swathi / 50% Guru)
      {
        id: 'sh_3',
        projectId: 'proj_angel',
        name: 'Swathi',
        stakePercentage: 50.0,
        capitalInvested: 300000,
        phone: '+91 99887 76655',
        email: 'swathi@angeljewellery.in'
      },
      {
        id: 'sh_4',
        projectId: 'proj_angel',
        name: 'Gurubrahmam G.',
        stakePercentage: 50.0,
        capitalInvested: 300000,
        phone: '+91 98765 43210',
        email: 'guru@angeljewellery.in'
      },
      // BSK Icon (70% Developer BSK / 30% Investor Ramani)
      {
        id: 'sh_5',
        projectId: 'proj_bsk',
        name: 'BSK Developers',
        stakePercentage: 70.0,
        capitalInvested: 2500000,
        phone: '+91 90000 11223',
        email: 'info@bsk.com'
      },
      {
        id: 'sh_6',
        projectId: 'proj_bsk',
        name: 'Ramani Gundareddy',
        stakePercentage: 30.0,
        capitalInvested: 1000000,
        phone: '+91 91234 56789',
        email: 'ramani@example.com'
      }
    ];

    // 3. Loans linked to projects or general
    this.loans = [
      {
        id: 'loan_1',
        projectId: 'proj_olivetree',
        lender: 'State Bank MSME Credit',
        type: 'Bank Business Loan',
        principal: 200000,
        rate: 11.5,
        tenureMonths: 24,
        date: d(45),
        logic: 'reducing',
        notes: 'Machinery expansion working credit'
      },
      {
        id: 'loan_2',
        projectId: 'proj_angel',
        lender: 'Angel Partner (John D.)',
        type: 'Private / Partner Loan',
        principal: 75000,
        rate: 8.0,
        tenureMonths: 12,
        date: d(20),
        logic: 'simple',
        notes: 'Short term silver & gem stock procurement'
      }
    ];

    // 4. Inflows
    this.inflows = [
      {
        id: 'inf_1',
        projectId: 'proj_olivetree',
        date: d(40),
        amount: 140000,
        source: 'Client Receivable Payment',
        desc: 'Phase 1 Milestone - Villa 32 Interior',
        method: 'Bank Transfer',
        ref: 'INV-OLV-101'
      },
      {
        id: 'inf_2',
        projectId: 'proj_angel',
        date: d(28),
        amount: 68500,
        source: 'Direct Sales Revenue',
        desc: 'Flash Vault collection jewelry orders',
        method: 'UPI / Online',
        ref: 'ORD-902'
      },
      {
        id: 'inf_3',
        projectId: 'proj_bsk',
        date: d(15),
        amount: 250000,
        source: 'Direct Sales Revenue',
        desc: 'Apartment Unit 302 Token Booking Advance',
        method: 'Bank Transfer',
        ref: 'ADV-302'
      },
      {
        id: 'inf_4',
        projectId: 'proj_olivetree',
        date: d(5),
        amount: 95000,
        source: 'Client Receivable Payment',
        desc: 'Kitchen & Modular Cabinet delivery clearance',
        method: 'Bank Transfer',
        ref: 'INV-OLV-104'
      }
    ];

    // 5. Daily Expenses
    this.expenses = [
      {
        id: 'exp_1',
        projectId: 'proj_olivetree',
        date: d(35),
        amount: 42000,
        category: 'Inventory / Raw Materials',
        desc: 'Plywood, laminates & hardware materials',
        method: 'Bank Transfer',
        ref: 'SUP-491'
      },
      {
        id: 'exp_2',
        projectId: 'proj_olivetree',
        date: d(25),
        amount: 25000,
        category: 'Salaries & Wages',
        desc: 'Carpentry crew labor weekly wages',
        method: 'Bank Transfer',
        ref: 'PAYROLL-01'
      },
      {
        id: 'exp_3',
        projectId: 'proj_angel',
        date: d(20),
        amount: 18500,
        category: 'Inventory / Raw Materials',
        desc: 'Silver casting & gift packaging boxes',
        method: 'UPI / Online',
        ref: 'PKG-281'
      },
      {
        id: 'exp_4',
        projectId: 'proj_bsk',
        date: d(12),
        amount: 45000,
        category: 'Maintenance & Equipment',
        desc: 'Site excavation & civil survey fees',
        method: 'Cheque',
        ref: 'SITE-101'
      },
      {
        id: 'exp_5',
        projectId: 'proj_angel',
        date: d(7),
        amount: 6200,
        category: 'Marketing & Sales',
        desc: 'Meta ad campaign for festive silver gifts',
        method: 'Credit Card',
        ref: 'FB-ADS-2'
      }
    ];

    // 6. Repayments
    this.repayments = [
      {
        id: 'rep_1',
        loanId: 'loan_1',
        date: d(15),
        mode: 'Bank Transfer',
        principalPart: 7450,
        interestPart: 1910,
        notes: 'Month 1 SBI MSME EMI deduction'
      }
    ];

    // 7. Distributions (Partner Payouts)
    this.distributions = [
      {
        id: 'dist_1',
        projectId: 'proj_olivetree',
        stakeholderId: 'sh_2', // Narayana
        date: d(10),
        amount: 25000,
        type: 'profit_payout',
        paymentMode: 'Bank Transfer',
        notes: 'Interim profit draw for Villa 32 phase 1'
      }
    ];
  }

  // --- Modal & Toast Controls ---
  openModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.remove('hidden');
  }

  closeModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.add('hidden');
  }

  showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    const msg = document.getElementById('toastMsg');
    const icon = document.getElementById('toastIcon');

    if (!toast || !msg) return;

    msg.innerText = message;
    if (isError) {
      icon.className = 'ph-bold ph-warning-circle text-rose-400 text-lg';
    } else {
      icon.className = 'ph-bold ph-check-circle text-emerald-400 text-lg';
    }

    toast.classList.remove('translate-y-20', 'opacity-0');
    setTimeout(() => {
      toast.classList.add('translate-y-20', 'opacity-0');
    }, 3200);
  }

  exportToCSV() {
    const entries = this.buildLedgerEntries();
    if (entries.length === 0) {
      this.showToast('No transaction data to export.', true);
      return;
    }

    const headers = ["Date", "Project", "Description", "Type", "Category", "Payment Method", "Outflow Amount", "Inflow Amount", "Account Balance"];
    const rows = entries.map(e => {
      const isCredit = e.type === 'INFLOW' || e.type === 'LOAN_BORROWED';
      return [
        `"${e.date}"`,
        `"${e.projectName.replace(/"/g, '""')}"`,
        `"${e.title.replace(/"/g, '""')}"`,
        `"${e.type}"`,
        `"${e.category}"`,
        `"${e.method || 'N/A'}"`,
        !isCredit ? e.amount : 0,
        isCredit ? e.amount : 0,
        e.runningBalance
      ];
    });

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `AccuBiz_MultiProject_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    this.showToast('Financial CSV exported successfully!');
  }
}

// Instantiate immediately
window.app = new BusinessAccountingApp();

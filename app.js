// AccuBiz - Business Account & Loan Assistant JavaScript Core

const SUPABASE_CONFIG = {
  url: 'https://zgkqexzaplzdyuilmhoj.supabase.co',
  key: 'sb_publishable_M_0gphmqtXHzfMCvPQplrg_G9x74TC7'
};

class BusinessAccountingApp {
  constructor() {
    this.currency = '₹';
    this.currentLedgerFilter = 'ALL';
    this.chartInstances = {};

    this.expenses = [];
    this.inflows = [];
    this.loans = [];
    this.repayments = [];

    this.isSupabaseConnected = false;

    // Initialize Supabase Client
    try {
      if (window.supabase && SUPABASE_CONFIG.url && SUPABASE_CONFIG.key) {
        this.db = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.key);
      }
    } catch (e) {
      console.warn('Supabase client init failed, falling back to local store:', e);
    }

    this.init();
  }


  // Convert number to words (supporting Indian numbering for ₹ and International for others)
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
      // Indian Numbering Format: Crores, Lakhs, Thousands, Hundreds
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
      // Western Format: Billions, Millions, Thousands, Hundreds
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

    // Add currency name
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
    ['expDate', 'inflowDate', 'loanDate', 'repayDate'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = todayStr;
    });

    this.bindEvents();
    this.loadData();
    this.runCalculator();
    this.refreshAll();

    // Check Cloud connection & sync
    if (this.db) {
      this.syncFromSupabase();
    } else {
      this.updateCloudStatus(false, 'Local Mode');
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

  // Fetch data directly from Supabase tables
  async syncFromSupabase() {
    if (!this.db) return;
    this.updateCloudStatus(false, 'Syncing...');

    try {
      const [expRes, infRes, loanRes, repRes] = await Promise.all([
        this.db.from('expenses').select('*').order('date', { ascending: false }),
        this.db.from('inflows').select('*').order('date', { ascending: false }),
        this.db.from('loans').select('*').order('date', { ascending: false }),
        this.db.from('repayments').select('*').order('date', { ascending: false })
      ]);

      let hasSupabaseData = false;

      if (!loanRes.error && loanRes.data && loanRes.data.length > 0) {
        this.loans = loanRes.data.map(l => ({
          id: l.id,
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
        this.refreshAll();
        ['expAmount', 'inflowAmount', 'loanPrincipal', 'repayPrincipalPart', 'repayInterestPart', 'calcPrincipal'].forEach(id => {
          this.updateAmountWords(id, id + 'Words');
        });
        this.updateCloudStatus(true, 'Cloud Synced');
      } else {
        this.updateCloudStatus(true, 'Cloud Ready (Empty)');
      }
    } catch (err) {
      console.warn('Supabase fetch failed:', err);
      this.updateCloudStatus(false, 'Local Offline');
    }
  }

  // Push all existing local demo data into Supabase
  async pushLocalToSupabase() {
    if (!this.db) {
      this.showToast('Supabase client not initialized', true);
      return;
    }

    this.showToast('Pushing data to Supabase...');

    try {
      // 1. Push Loans
      if (this.loans.length > 0) {
        const loanRows = this.loans.map(l => ({
          id: l.id,
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

      // 2. Push Inflows
      if (this.inflows.length > 0) {
        const inflowRows = this.inflows.map(i => ({
          id: i.id,
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

      // 3. Push Expenses
      if (this.expenses.length > 0) {
        const expenseRows = this.expenses.map(e => ({
          id: e.id,
          date: e.date,
          amount: e.amount,
          category: e.category,
          description: e.desc,
          payment_mode: e.method,
          reference: e.ref
        }));
        const { error: eErr } = await this.db.from('expenses').upsert(expenseRows);
        if (eErr) throw eErr;
      }

      // 4. Push Repayments
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

      this.updateCloudStatus(true, 'Cloud Synced');
      this.showToast('All local data saved into Supabase tables!');
    } catch (err) {
      console.error('Error pushing data to Supabase:', err);
      this.showToast('Error syncing with Supabase: ' + err.message, true);
    }
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
        ['expAmount', 'inflowAmount', 'loanPrincipal', 'repayPrincipalPart', 'repayInterestPart', 'calcPrincipal'].forEach(id => {
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

    ['dashboard', 'expenses', 'inflows', 'loans', 'ledger', 'calculator'].forEach(sec => {
      const el = document.getElementById(`section-${sec}`);
      if (el) {
        if (sec === sectionId) el.classList.remove('hidden');
        else el.classList.add('hidden');
      }
    });

    const titles = {
      dashboard: { t: 'Financial Dashboard', sub: 'Live operational liquidity, debt obligations, and profit margins' },
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

    if (sectionId === 'expenses') this.renderExpenses();
    if (sectionId === 'inflows') this.renderInflows();
    if (sectionId === 'loans') this.renderLoans();
    if (sectionId === 'ledger') this.renderLedger();
    if (sectionId === 'dashboard') this.renderCharts();
  }

  calculateTotals() {
    const totalExpenses = this.expenses.reduce((sum, item) => sum + Number(item.amount), 0);
    const totalInflows = this.inflows.reduce((sum, item) => sum + Number(item.amount), 0);
    const totalLoanBorrowed = this.loans.reduce((sum, item) => sum + Number(item.principal), 0);
    const totalPrincipalRepaid = this.repayments.reduce((sum, item) => sum + Number(item.principalPart), 0);
    const totalInterestPaid = this.repayments.reduce((sum, item) => sum + Number(item.interestPart), 0);

    const activePrincipalRemaining = Math.max(0, totalLoanBorrowed - totalPrincipalRepaid);

    let estimatedTotalInterestLiability = 0;
    this.loans.forEach(loan => {
      const p = Number(loan.principal);
      const r = Number(loan.rate) / 100;
      const tYears = Number(loan.tenureMonths) / 12;
      estimatedTotalInterestLiability += (p * r * tYears);
    });

    const netCashBalance = (totalInflows + totalLoanBorrowed) - (totalExpenses + totalPrincipalRepaid + totalInterestPaid);

    return {
      totalExpenses,
      totalInflows,
      totalLoanBorrowed,
      totalPrincipalRepaid,
      totalInterestPaid,
      activePrincipalRemaining,
      estimatedTotalInterestLiability,
      netCashBalance
    };
  }

  refreshAll() {
    const stats = this.calculateTotals();

    const netEl = document.getElementById('statNetBalance');
    if (netEl) {
      netEl.innerText = `${this.currency}${stats.netCashBalance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
      if (stats.netCashBalance < 0) {
        netEl.className = 'text-2xl lg:text-3xl font-extrabold text-rose-600 tracking-tight';
      } else {
        netEl.className = 'text-2xl lg:text-3xl font-extrabold text-emerald-600 tracking-tight';
      }
    }

    const expEl = document.getElementById('statTotalExpenses');
    if (expEl) expEl.innerText = `${this.currency}${stats.totalExpenses.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

    const loanEl = document.getElementById('statActiveLoans');
    if (loanEl) loanEl.innerText = `${this.currency}${stats.activePrincipalRemaining.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

    const intEl = document.getElementById('statTotalInterest');
    if (intEl) intEl.innerText = `${this.currency}${stats.estimatedTotalInterestLiability.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

    const expBreakdown = document.getElementById('statExpenseBreakdownCount');
    if (expBreakdown) expBreakdown.innerText = `${this.expenses.length} transaction${this.expenses.length === 1 ? '' : 's'} recorded`;

    const activeLoanCount = document.getElementById('statActiveLoanCount');
    if (activeLoanCount) activeLoanCount.innerText = `${this.loans.filter(l => this.getLoanRemainingPrincipal(l.id) > 0).length} active borrowing${this.loans.length === 1 ? '' : 's'}`;

    const paidInterest = document.getElementById('statPaidInterest');
    if (paidInterest) paidInterest.innerText = `${this.currency}${stats.totalInterestPaid.toLocaleString(undefined, {minimumFractionDigits: 2})} paid to lenders`;

    this.renderDashboardLoanList();
    this.renderDashboardRecentLedger();
    this.renderCharts();
    this.renderExpenses();
    this.renderInflows();
    this.renderLoans();
    this.renderLedger();
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

    const activeLoans = this.loans.filter(l => this.getLoanRemainingPrincipal(l.id) > 0);

    if (activeLoans.length === 0) {
      container.innerHTML = `
        <div class="py-6 text-center text-slate-400 text-xs">
          <i class="ph ph-check-circle text-2xl text-emerald-500 mb-1"></i>
          <p>Your business is debt-free! No active loans.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = activeLoans.slice(0, 3).map(loan => {
      const remaining = this.getLoanRemainingPrincipal(loan.id);
      const percentPaid = Math.round(((Number(loan.principal) - remaining) / Number(loan.principal)) * 100);
      return `
        <div class="p-3 bg-slate-50 border border-slate-100 rounded-xl space-y-2">
          <div class="flex items-center justify-between">
            <div>
              <h5 class="font-bold text-slate-800 text-xs">${loan.lender}</h5>
              <p class="text-[11px] text-slate-500">${loan.rate}% p.a. • ${loan.tenureMonths} Months</p>
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

  renderDashboardRecentLedger() {
    const container = document.getElementById('dashboardRecentLedger');
    if (!container) return;

    const allEntries = this.buildLedgerEntries().slice(0, 4);

    if (allEntries.length === 0) {
      container.innerHTML = '<div class="py-6 text-center text-slate-400 text-xs">No transactions recorded yet.</div>';
      return;
    }

    container.innerHTML = allEntries.map(entry => {
      const isCredit = entry.type === 'INFLOW' || entry.type === 'LOAN_BORROWED';
      return `
        <div class="flex items-center justify-between py-2 border-b border-slate-100 last:border-0 text-xs">
          <div class="flex items-center space-x-2.5">
            <div class="w-7 h-7 rounded-lg flex items-center justify-center ${isCredit ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}">
              <i class="ph ${isCredit ? 'ph-arrow-down-left' : 'ph-arrow-up-right'}"></i>
            </div>
            <div>
              <p class="font-semibold text-slate-800 leading-tight">${entry.title}</p>
              <p class="text-[10px] text-slate-400">${entry.date} • ${entry.method || 'General'}</p>
            </div>
          </div>
          <span class="font-bold ${isCredit ? 'text-emerald-600' : 'text-rose-600'}">
            ${isCredit ? '+' : '-'}${this.currency}${Number(entry.amount).toLocaleString(undefined, {minimumFractionDigits: 2})}
          </span>
        </div>
      `;
    }).join('');
  }

  buildLedgerEntries() {
    const list = [];

    this.inflows.forEach(i => {
      list.push({
        id: i.id,
        date: i.date,
        timestamp: new Date(i.date).getTime(),
        title: `${i.source}: ${i.desc}`,
        category: i.source,
        type: 'INFLOW',
        amount: Number(i.amount),
        method: i.method
      });
    });

    this.expenses.forEach(e => {
      list.push({
        id: e.id,
        date: e.date,
        timestamp: new Date(e.date).getTime(),
        title: `Expense: ${e.desc} (${e.category})`,
        category: e.category,
        type: 'EXPENSE',
        amount: Number(e.amount),
        method: e.method
      });
    });

    this.loans.forEach(l => {
      list.push({
        id: l.id,
        date: l.date,
        timestamp: new Date(l.date).getTime(),
        title: `Loan Received: ${l.lender} (${l.type || 'Debt'})`,
        category: 'Loan Inflow',
        type: 'LOAN_BORROWED',
        amount: Number(l.principal),
        method: 'Bank / Direct'
      });
    });

    this.repayments.forEach(r => {
      const loanObj = this.loans.find(l => l.id === r.loanId);
      const lenderName = loanObj ? loanObj.lender : 'Lender';
      const totalOutflow = Number(r.principalPart) + Number(r.interestPart);

      list.push({
        id: r.id,
        date: r.date,
        timestamp: new Date(r.date).getTime(),
        title: `Repayment to ${lenderName} (P: ${this.currency}${r.principalPart} + Int: ${this.currency}${r.interestPart})`,
        category: 'Debt Repayment',
        type: 'LOAN_REPAYMENT',
        amount: totalOutflow,
        method: r.mode
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
    const stats = this.calculateTotals();

    const barCanvas = document.getElementById('cashflowBarChart');
    if (barCanvas) {
      if (this.chartInstances.cashflow) this.chartInstances.cashflow.destroy();

      const ctx = barCanvas.getContext('2d');
      this.chartInstances.cashflow = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: ['Sales & Revenue', 'Loans Inflow', 'Daily Expenses', 'Principal Repaid', 'Interest Paid'],
          datasets: [{
            data: [
              stats.totalInflows,
              stats.totalLoanBorrowed,
              stats.totalExpenses,
              stats.totalPrincipalRepaid,
              stats.totalInterestPaid
            ],
            backgroundColor: ['#10b981', '#6366f1', '#f43f5e', '#f59e0b', '#a855f7'],
            borderRadius: 8,
            barThickness: 28
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
      this.expenses.forEach(e => {
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
    const catFilter = document.getElementById('expenseCategoryFilter')?.value || 'ALL';
    const methodFilter = document.getElementById('expenseMethodFilter')?.value || 'ALL';

    const filtered = this.expenses.filter(item => {
      const matchesQuery = item.desc.toLowerCase().includes(query) || (item.ref || '').toLowerCase().includes(query);
      const matchesCat = catFilter === 'ALL' || item.category === catFilter;
      const matchesMethod = methodFilter === 'ALL' || item.method === methodFilter;
      return matchesQuery && matchesCat && matchesMethod;
    }).sort((a, b) => new Date(b.date) - new Date(a.date));

    if (filtered.length === 0) {
      tbody.innerHTML = '';
      emptyMsg?.classList.remove('hidden');
      return;
    }

    emptyMsg?.classList.add('hidden');
    tbody.innerHTML = filtered.map(item => `
      <tr class="hover:bg-slate-50/80 transition-colors">
        <td class="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">${item.date}</td>
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
    `).join('');
  }

  renderInflows() {
    const tbody = document.getElementById('inflowsTableBody');
    const emptyMsg = document.getElementById('emptyInflowMsg');
    if (!tbody) return;

    const list = [...this.inflows].sort((a, b) => new Date(b.date) - new Date(a.date));

    if (list.length === 0) {
      tbody.innerHTML = '';
      emptyMsg?.classList.remove('hidden');
      return;
    }

    emptyMsg?.classList.add('hidden');
    tbody.innerHTML = list.map(item => `
      <tr class="hover:bg-slate-50/80 transition-colors">
        <td class="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">${item.date}</td>
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
    `).join('');
  }

  renderLoans() {
    const container = document.getElementById('loansCardsContainer');
    const repBody = document.getElementById('repaymentsTableBody');
    const emptyRepMsg = document.getElementById('emptyRepaymentMsg');
    if (!container) return;

    if (this.loans.length === 0) {
      container.innerHTML = `
        <div class="col-span-full py-12 text-center bg-white rounded-2xl border border-slate-200 text-slate-400">
          <i class="ph ph-bank text-4xl mb-2 text-slate-300"></i>
          <p>No business loans borrowed yet.</p>
          <button onclick="window.app && window.app.openModal('loanModal')" class="mt-3 inline-flex items-center space-x-1.5 text-xs text-indigo-600 font-bold hover:underline">
            <span>+ Borrow Loan</span>
          </button>
        </div>
      `;
    } else {
      container.innerHTML = this.loans.map(loan => {
        const remaining = this.getLoanRemainingPrincipal(loan.id);
        const totalRepaidPrincipal = Number(loan.principal) - remaining;
        const interestPaid = this.getLoanTotalInterestPaid(loan.id);
        const isFullyPaid = remaining <= 0;
        const percentRepaid = Math.min(100, Math.round((totalRepaidPrincipal / Number(loan.principal)) * 100));

        const p = Number(loan.principal);
        const r = (Number(loan.rate) / 12) / 100;
        const n = Number(loan.tenureMonths);
        let estEMI = 0;
        if (r > 0) {
          estEMI = (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
        } else {
          estEMI = p / n;
        }

        return `
          <div class="bg-white rounded-2xl p-5 border ${isFullyPaid ? 'border-emerald-200 bg-emerald-50/20' : 'border-slate-200'} shadow-sm space-y-4 flex flex-col justify-between">
            <div>
              <div class="flex items-start justify-between">
                <div>
                  <span class="text-[10px] font-bold uppercase tracking-wider text-slate-400">${loan.type || 'Commercial Debt'}</span>
                  <h4 class="font-bold text-slate-900 text-base leading-tight">${loan.lender}</h4>
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
      if (this.repayments.length === 0) {
        repBody.innerHTML = '';
        emptyRepMsg?.classList.remove('hidden');
      } else {
        emptyRepMsg?.classList.add('hidden');
        const sortedRep = [...this.repayments].sort((a, b) => new Date(b.date) - new Date(a.date));
        repBody.innerHTML = sortedRep.map(r => {
          const loanObj = this.loans.find(l => l.id === r.loanId);
          const lender = loanObj ? loanObj.lender : 'Unknown Lender';
          const total = Number(r.principalPart) + Number(r.interestPart);
          return `
            <tr class="hover:bg-slate-50 transition-colors">
              <td class="py-2.5 px-3 font-medium text-slate-900">${r.date}</td>
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
    }

    if (entries.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="py-12 text-center text-slate-400">No ledger entries matching criteria.</td></tr>`;
      return;
    }

    tbody.innerHTML = entries.map(item => {
      const isCredit = item.type === 'INFLOW' || item.type === 'LOAN_BORROWED';
      const typeBadge = {
        INFLOW: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        EXPENSE: 'bg-rose-50 text-rose-700 border-rose-200',
        LOAN_BORROWED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
        LOAN_REPAYMENT: 'bg-purple-50 text-purple-700 border-purple-200'
      }[item.type];

      return `
        <tr class="hover:bg-slate-50 transition-colors">
          <td class="py-3 px-4 whitespace-nowrap text-slate-700">${item.date}</td>
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

  async handleExpenseSubmit(e) {
    e.preventDefault();
    const expense = {
      id: 'exp_' + Date.now(),
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

    // Async push to Supabase
    if (this.db) {
      this.db.from('expenses').insert([{
        id: expense.id,
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

    // Async push to Supabase
    if (this.db) {
      this.db.from('inflows').insert([{
        id: inflow.id,
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
    this.showToast(`Loan from ${loan.lender} credited to business account!`);

    // Async push to Supabase
    if (this.db) {
      this.db.from('loans').insert([{
        id: loan.id,
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
      this.showToast(`Principal part cannot exceed remaining balance of ${this.currency}${remaining.toLocaleString()}`, true);
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
    const w4 = document.getElementById('repayPrincipalWords'); if (w4) w4.innerText = ''; const w5 = document.getElementById('repayInterestWords'); if (w5) w5.innerText = ''; const w6 = document.getElementById('repayTotalWords'); if (w6) w6.innerText = '';
    document.getElementById('repayDate').value = new Date().toISOString().split('T')[0];
    this.refreshAll();
    this.showToast('Repayment logged! Debt and account balance updated.');

    // Async push to Supabase
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

  deleteExpense(id) {
    this.expenses = this.expenses.filter(e => e.id !== id);
    this.saveData();
    this.refreshAll();
    this.showToast('Expense removed.');

    if (this.db) {
      this.db.from('expenses').delete().eq('id', id).then(() => {});
    }
  }

  deleteInflow(id) {
    this.inflows = this.inflows.filter(i => i.id !== id);
    this.saveData();
    this.refreshAll();
    this.showToast('Revenue entry removed.');

    if (this.db) {
      this.db.from('inflows').delete().eq('id', id).then(() => {});
    }
  }

  deleteLoan(loanId) {
    this.loans = this.loans.filter(l => l.id !== loanId);
    this.repayments = this.repayments.filter(r => r.loanId !== loanId);
    this.saveData();
    this.refreshAll();
    this.showToast('Loan and repayment records deleted.');

    if (this.db) {
      this.db.from('loans').delete().eq('id', loanId).then(() => {});
    }
  }

  deleteRepayment(repId) {
    this.repayments = this.repayments.filter(r => r.id !== repId);
    this.saveData();
    this.refreshAll();
    this.showToast('Repayment installment deleted.');

    if (this.db) {
      this.db.from('repayments').delete().eq('id', repId).then(() => {});
    }
  }

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

    const headers = ["Date", "Description", "Type", "Category", "Payment Method", "Outflow Amount", "Inflow Amount", "Account Balance"];
    const rows = entries.map(e => {
      const isCredit = e.type === 'INFLOW' || e.type === 'LOAN_BORROWED';
      return [
        `"${e.date}"`,
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
    link.setAttribute("download", `AccuBiz_Statement_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    this.showToast('Financial CSV exported successfully!');
  }

  saveData() {
    try {
      const state = {
        expenses: this.expenses,
        inflows: this.inflows,
        loans: this.loans,
        repayments: this.repayments,
        currency: this.currency
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

    if (loaded && (loaded.expenses?.length || loaded.inflows?.length || loaded.loans?.length)) {
      this.expenses = loaded.expenses || [];
      this.inflows = loaded.inflows || [];
      this.loans = loaded.loans || [];
      this.repayments = loaded.repayments || [];
      this.currency = loaded.currency || '₹';
      const sel = document.getElementById('currencySelector');
      if (sel) sel.value = this.currency;
    } else {
      this.seedInitialBusinessData();
    }
  }

  resetDemoData() {
    this.seedInitialBusinessData();
    this.saveData();
    this.refreshAll();
    this.showToast('Demo business transactions reloaded!');
  }

  seedInitialBusinessData() {
    const today = new Date();
    const d = (daysAgo) => {
      const target = new Date(today);
      target.setDate(target.getDate() - daysAgo);
      return target.toISOString().split('T')[0];
    };

    this.currency = '₹';
    const sel = document.getElementById('currencySelector');
    if (sel) sel.value = '₹';

    this.loans = [
      {
        id: 'loan_1',
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
        lender: 'Angel Partner (John D.)',
        type: 'Private / Partner Loan',
        principal: 75000,
        rate: 8.0,
        tenureMonths: 12,
        date: d(20),
        logic: 'simple',
        notes: 'Short term stock procurement'
      }
    ];

    this.inflows = [
      {
        id: 'inf_1',
        date: d(40),
        amount: 85000,
        source: 'Owner Capital Contribution',
        desc: 'Initial working capital deposit',
        method: 'Bank Transfer',
        ref: 'CAP-001'
      },
      {
        id: 'inf_2',
        date: d(28),
        amount: 42500,
        source: 'Direct Sales Revenue',
        desc: 'Bulk client invoice clearance #201',
        method: 'Bank Transfer',
        ref: 'INV-201'
      },
      {
        id: 'inf_3',
        date: d(12),
        amount: 38200,
        source: 'Direct Sales Revenue',
        desc: 'Weekly store counter cash collections',
        method: 'Cash',
        ref: 'POS-W2'
      },
      {
        id: 'inf_4',
        date: d(3),
        amount: 64000,
        source: 'Client Receivable Payment',
        desc: 'Corporate quarterly order delivery',
        method: 'UPI / Online',
        ref: 'INV-284'
      }
    ];

    this.expenses = [
      {
        id: 'exp_1',
        date: d(35),
        amount: 52000,
        category: 'Inventory / Raw Materials',
        desc: 'Wholesale textile raw material fabric',
        method: 'Bank Transfer',
        ref: 'SUP-491'
      },
      {
        id: 'exp_2',
        date: d(25),
        amount: 25000,
        category: 'Rent & Property',
        desc: 'Commercial showroom monthly rent',
        method: 'Bank Transfer',
        ref: 'RENT-OCT'
      },
      {
        id: 'exp_3',
        date: d(20),
        amount: 32000,
        category: 'Salaries & Wages',
        desc: 'Staff payroll disbursement',
        method: 'Bank Transfer',
        ref: 'PAYROLL-01'
      },
      {
        id: 'exp_4',
        date: d(14),
        amount: 4800,
        category: 'Utilities & Bills',
        desc: 'Factory electricity & broadband bill',
        method: 'UPI / Online',
        ref: 'EB-992'
      },
      {
        id: 'exp_5',
        date: d(7),
        amount: 7200,
        category: 'Logistics & Delivery',
        desc: 'Interstate transport freight courier fees',
        method: 'Cash',
        ref: 'FRG-102'
      },
      {
        id: 'exp_6',
        date: d(2),
        amount: 5500,
        category: 'Marketing & Sales',
        desc: 'Social media ads & flyers campaign',
        method: 'Credit Card',
        ref: 'FB-ADS-2'
      }
    ];

    this.repayments = [
      {
        id: 'rep_1',
        loanId: 'loan_1',
        date: d(15),
        mode: 'Bank Transfer',
        principalPart: 7450,
        interestPart: 1910,
        notes: 'Month 1 SBI EMI deduction'
      }
    ];
  }
}

// Instantiate immediately so global click handlers find window.app
window.app = new BusinessAccountingApp();

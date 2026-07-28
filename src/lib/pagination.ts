// Reusable client-side pagination for content grids (articles, worksheets,
// assessments). Sits on top of existing search/filter logic: filtering
// decides which items are *eligible*; this decides which page of the
// eligible items is actually shown.

export function createPaginator(opts: {
  pagerEl: HTMLElement;
  pageSize?: number;
}) {
  const pageSize = opts.pageSize ?? 9;
  let currentPage = 1;

  function render(eligible: HTMLElement[]) {
    const totalPages = Math.max(1, Math.ceil(eligible.length / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    eligible.forEach((el, i) => {
      el.classList.toggle('is-paged-out', i < start || i >= end);
    });

    opts.pagerEl.innerHTML = '';
    if (totalPages <= 1) return;

    const makeBtn = (label: string, page: number, disabled = false, current = false) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pager-btn' + (current ? ' is-current' : '');
      btn.textContent = label;
      btn.disabled = disabled;
      btn.addEventListener('click', () => {
        currentPage = page;
        render(eligible);
        opts.pagerEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      return btn;
    };

    opts.pagerEl.appendChild(makeBtn('← Previous', currentPage - 1, currentPage === 1));

    for (let p = 1; p <= totalPages; p++) {
      opts.pagerEl.appendChild(makeBtn(String(p), p, false, p === currentPage));
    }

    opts.pagerEl.appendChild(makeBtn('Next →', currentPage + 1, currentPage === totalPages));
  }

  return {
    // Call whenever the eligible (filtered) set changes — resets to page 1.
    refresh(eligible: HTMLElement[]) {
      currentPage = 1;
      render(eligible);
    },
  };
}

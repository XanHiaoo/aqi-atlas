"use strict";
window.aqiDesktopSort={setup(container,reorder){
  for(const chip of container.children){
    const handle=document.createElement("button"),name=chip.querySelector("input").getAttribute("aria-label");
    handle.type="button";handle.className="desktop-sort-handle";handle.textContent="⠿";handle.draggable=true;handle.title="拖动排序；方向键调整位置";handle.setAttribute("aria-label","排序"+name);handle.setAttribute("aria-keyshortcuts","ArrowLeft ArrowRight ArrowUp ArrowDown");chip.insertBefore(handle,chip.querySelector(".city-delete"));
  }
  if(container.dataset.sortReady)return;container.dataset.sortReady="true";
  const status=document.createElement("span");status.className="sr-only";status.setAttribute("role","status");container.after(status);
  const keys=()=>[...container.children].map(chip=>chip.dataset.city);
  let dragged=null;
  function reset(){dragged=null;container.querySelectorAll(".sort-target").forEach(chip=>chip.classList.remove("sort-target"));window.aqiSite.setBusy(false);}
  container.addEventListener("dragstart",event=>{const handle=event.target.closest(".desktop-sort-handle");if(!handle)return;dragged=handle.closest(".city-option").dataset.city;event.dataTransfer.setData("text/plain",dragged);event.dataTransfer.effectAllowed="move";window.aqiSite.setBusy(true);});
  container.addEventListener("dragover",event=>{if(!dragged)return;const chip=event.target.closest(".city-option");if(!chip)return;event.preventDefault();event.dataTransfer.dropEffect="move";container.querySelectorAll(".sort-target").forEach(node=>node.classList.toggle("sort-target",node===chip));chip.classList.add("sort-target");});
  container.addEventListener("drop",event=>{if(!dragged)return;event.preventDefault();const target=event.target.closest(".city-option"),order=keys(),from=order.indexOf(dragged),to=order.indexOf(target?.dataset.city);reset();if(to<0||from===to)return;order.splice(to,0,order.splice(from,1)[0]);reorder(order);status.textContent="城市顺序已更新";});
  container.addEventListener("dragend",reset);
  container.addEventListener("keydown",event=>{
    const handle=event.target.closest(".desktop-sort-handle");if(!handle)return;
    const chips=[...container.children],columns=chips.filter(chip=>Math.abs(chip.getBoundingClientRect().top-chips[0].getBoundingClientRect().top)<2).length,move={ArrowLeft:-1,ArrowRight:1,ArrowUp:-columns,ArrowDown:columns}[event.key];
    if(!move)return;event.preventDefault();const order=keys(),from=order.indexOf(handle.closest(".city-option").dataset.city),to=Math.max(0,Math.min(order.length-1,from+move));if(from===to)return;
    order.splice(to,0,order.splice(from,1)[0]);reorder(order);handle.focus({preventScroll:true});status.textContent="城市已移动到第 "+(to+1)+" 位";
  });
}};

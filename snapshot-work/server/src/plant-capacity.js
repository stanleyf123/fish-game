'use strict';
function limit(cfg,save){const r=cfg.aquascape?.rules||{},ceiling=r.maxPlants||60;if(!r.tankScaledPlants)return ceiling;const level=Math.max(0,Math.min(cfg.capacity?.upgrades?.length||12,Math.floor(Number(save?.up?.cap)||0)));return Math.min(ceiling,(r.plantBaseLimit??60)+(r.plantPerTankLevel??5)*level)}
module.exports={limit};

const request = require('request');
const http = require('http');
const url = require('url');
const fs = require('fs');
const crypt = require('crypto');

var port = 80;
var bots = [];
var mostFitBot;
var generation = 0;
var accumulatedProfit = 0;
var purchaseThreshhold = 0.01;
var currencyToTrade = "BTC-USD";
var allowLive = true;
var lossThreshold = -5.0;
var startTime = Date.now();
var filename;

var api = {};

var realProfit = {
	lpp: 0,
	amount: 0,
	accumulated: 0,
	total: 0,
	fees: 0
};

var latestValues = {
	tradeData: {
		"60": [],
		"300": [],
		"900": []
	},
	average: {
		"60": 0,
		"300": 0,
		"900": 0
	},
	stddev: {
		"60": 0,
		"300": 0,
		"900": 0
	},
	rsi: {
		"60": 0,
		"300": 0,
		"900": 0
	},
	bolBands: {
		"60": {
			upper: 0,
			middle: 0,
			lower: 0
		},
		"300": {
			upper: 0,
			middle: 0,
			lower: 0
		},
		"900": {
			upper: 0,
			middle: 0,
			lower: 0
		}
	},
	cci: {
		"60": 0,
		"300": 0,
		"900": 0
	},
	price: 0,
	smaBelow: {
		"60": null,
		"300": null,
		"900": null
	}
};

var genePool = { 
	bollinger: function(step) {
		return indicators.bollinger[step.toString()];
	},
	sma_crossover: function(step) {
		return indicators.sma_crossover[step.toString()];
	},
	rsi: function(step) {
		return indicators.rsi[step.toString()];
	},
	cci: function(step) {
		return indicators.cci[step.toString()];
	},
	r_bollinger: function(step) {
		return indicators.r_bollinger[step.toString()];
	},
	r_sma_crossover: function(step) {
		return indicators.r_sma_crossover[step.toString()];
	},
	r_rsi: function(step) {
		return indicators.r_rsi[step.toString()];
	},
	r_cci: function(step) {
		return indicators.r_cci[step.toString()];
	}
};

var indicators = {
	bollinger: {
		"60": "hold",
		"300": "hold",
		"900": "hold"
	},
	sma_crossover: {
		"60": "hold",
		"300": "hold",
		"900": "hold"
	},
	rsi: {
		"60": "hold",
		"300": "hold",
		"900": "hold"
	},
	cci: {
		"60": "hold",
		"300": "hold",
		"900": "hold"
	},
	r_bollinger: {
		"60": "hold",
		"300": "hold",
		"900": "hold"
	},
	r_sma_crossover: {
		"60": "hold",
		"300": "hold",
		"900": "hold"
	},
	r_rsi: {
		"60": "hold",
		"300": "hold",
		"900": "hold"
	},
	r_cci: {
		"60": "hold",
		"300": "hold",
		"900": "hold"
	}
};

var holdings = {
	lastPurchasePrice: 0,
	eth: 0
};

var randomProperty = function (obj) {
    var keys = Object.keys(obj)
    return obj[keys[ keys.length * Math.random() << 0]];
};

var randomStep = function() {
	var r = Math.random();
	if(r < 0.3) {
		return 60;
	} else if(r < 0.6) {
		return 300;
	} else return 900;
};

var Bot = function() {
	var currentBot = {
		live: false,
		currentHoldings: {
			profit: 0,
			eth: 0,
			lastPurchasePrice: 0
		},
		decision: "hold",
		createRandomGenome: function() {
			for(var i=0; i<3; i++) {
				var p = randomProperty(genePool);
				var pack = {
					func: p,
					step: randomStep()
				};
				this.genes.push(pack);
			}
			for(var k in this.genes) {
				var s = randomProperty(k);
				delete s;
			}
		},
		copyGenome: function(oldGenome) {
			this.genes = oldGenome;
		},
		mutate: function() {
			//mutate a random gene
			var randomGene = randomProperty(genePool);
			var r = ( Math.random() * this.genes.length << 0 );
			var pack = {
				func: randomGene,
				step: randomStep()
			};
			this.genes[r] = pack;
		},
		changeRuleset: function(c) {
			//Changes ruleset to a new function.
			this.ruleset = c;
		},
		ruleset: function() {
			var buyCount = sellCount = holdCount = 0;
			var results = [];
			for(var i in this.genes) {
				results.push(this.genes[i].func(this.genes[i].step));
			}
			for(var k in results) { 
				if(results[k] == "buy") {
					buyCount++;
				} else if(results[k] == "sell") {
					sellCount++;
				} else {
					holdCount++;
				}
			}
			if(buyCount > holdCount && buyCount > sellCount) {
				this.decision = "buy";
			} else if(sellCount > holdCount && sellCount > buyCount) {
				this.decision = "sell";
			} else {
				this.decision = "hold";
			}
		},
		makeTradeDecision: function() {
			if(this.decision == "buy" && this.currentHoldings.eth < 0.001) {
				if(this.live && allowLive) {
					postBuy();
				} else {
					this.currentHoldings.profit -= latestValues.price * 0.0025 * purchaseThreshhold;
					this.currentHoldings.eth += purchaseThreshhold;
					this.currentHoldings.lastPurchasePrice = latestValues.price;
				}
			} else if (this.decision == "sell" && this.currentHoldings.eth > 0.001) {
				if(this.live && allowLive) {
					postSell();
				} else {
					this.currentHoldings.profit -= latestValues.price * 0.0025 * purchaseThreshhold;
					this.currentHoldings.profit += ( (this.currentHoldings.eth * latestValues.price) - (this.currentHoldings.eth * this.currentHoldings.lastPurchasePrice) );
					this.currentHoldings.eth -= this.currentHoldings.eth;
					this.currentHoldings.lastPurchasePrice = 0;
				}
			}
		},
		genes: []
	};
	return currentBot;
}

function getTime(type, callback) {
	var options = {
		url: "https://api.gdax.com/time",
		headers: {
			'User-Agent':'SomethingSomethingTest'
		}
	};
	request(options, (error, response, body) => {
		try {
			var json = JSON.parse(body);
			if ("message" in json) {
				console.log("Error returned by exchange: " + json.message);
			} else {
				if(type === 'iso') {
					return callback(json.iso);
				} else if(type === 'epoch') {
					return callback(json.epoch);
				}
			}
		} catch(e) {
			console.log("Exception caught: " + e);
		}	
	});
}

function getPrice(callback) {
	var options = {
		url: "https://api.gdax.com/products/" + currencyToTrade + "/ticker",
		headers: {
			'User-Agent':'SomethingSomethingTest'
		}
	};
	request(options, (error, response, body) => {
		try {
			var json = JSON.parse(body);
			if("message" in json) {
				console.log("Error returned by exchange: " + json.message);
			} else {
				latestValues.price = json.price;
				return callback(json.price);
			}
		} catch(e) {
			console.log("Exception caught: " + e);
		}
	});
}

function getTradeData(step, callback) {
	var options = {
		url: "https://api.gdax.com/products/" + currencyToTrade + "/candles?granularity=" + encodeURIComponent(step),
		headers: {
			'User-Agent':'SomethingSomethingTest'
		}
	};
	request(options, (error, response, body) => {
		try {
			var json = JSON.parse(body);
			if("message" in json) {
				console.log("Error returned by exchange: " + json.message);
			}
			else {
				latestValues.tradeData[step.toString()] = json;
				return callback(json);
			}
			} catch(e) {
				console.log("Exception caught: " + e);
		}
	});
}

function getAccountInfo() {
	//Message signing
	
	var ts = (Date.now() / 1000).toString();
	var rp = "/accounts";
	var method = "GET";
	var w = ts + method + rp;
	var k = Buffer(api.sc, 'base64');
	var hmac = crypt.createHmac('sha256', k);
	
	var options = {
		url: "https://api.gdax.com/accounts",
		headers: {
				'User-Agent':'SomethingSomethingTest',
				'CB-ACCESS-KEY': api.key,
				'CB-ACCESS-SIGN': hmac.update(w).digest('base64'),
				'CB-ACCESS-TIMESTAMP': Date.now()/1000,
				'CB-ACCESS-PASSPHRASE': api.pp
			}
	};
	request(options, function(err,response,body) {
		try {
			var json = JSON.parse(body);
			var c;
			switch(currencyToTrade) {
				case "BTC-USD":
					c = 'BTC';
					break;
				case "LTC-USD":
					c = 'LTC';
					break;
				case "ETH-USD":
					c = 'ETH';
					break;
			}
			for(var k in json) {
				if(json[k].currency === c) {
					if(mostFitBot !== undefined) {
						mostFitBot.currentHoldings.eth = json[k].available;
						realProfit.amount = json[k].available;
					} else {
						holdings.eth = json[k].available;
						realProfit.amount = json[k].available;
					}
				}
			}
		} catch(e) {
			console.log("Exception caught: " + e);
		}
	});
}

function postBuy() {
	if(allowLive) {
		var ts = (Date.now() / 1000).toString();
		var rp = "/orders";
		var method = "POST";
		var b = JSON.stringify({
			type: "market",
			product_id: currencyToTrade,
			side: "buy",
			size: purchaseThreshhold.toString()
		});
		var w = ts + method + rp + b;
		var k = Buffer(api.sc, 'base64');
		var hmac = crypt.createHmac('sha256', k);
		var options = {
			url: "https://api.gdax.com/orders",
			method: "POST",
			headers: {
					'User-Agent':'SomethingSomethingTest',
					'CB-ACCESS-KEY': api.key,
					'CB-ACCESS-SIGN': hmac.update(w).digest('base64'),
					'CB-ACCESS-TIMESTAMP': ts,
					'CB-ACCESS-PASSPHRASE': api.pp,
					'Accept' : 'application/json',
					'Content-Type': 'application/json',
			},
			body: b
		};
		request(options, function(err,response,body) {
			if(err) {
				console.log(err);
			} else {
				try {
					var json = JSON.parse(body);
					var fn = "purchaseLog-" + Date.now().toString() + ".txt";
					fs.writeFile(fn, JSON.stringify(json), function(err) {
						if(err) {
							console.log(err);
						} else {
							console.log("Purchase recorded successfully");
						}
					});
					setTimeout(function() {
						getAccountInfo();
						setTimeout(function() {
							var ts = (Date.now() / 1000).toString();
							var rp = "/fills?product_id="+currencyToTrade;
							var method = "GET";
							var w = ts + method + rp;
							var k = Buffer(api.sc, 'base64');
							var hmac = crypt.createHmac('sha256', k);
							
							var options = {
								url: "https://api.gdax.com/fills?product_id="+currencyToTrade,
								headers: {
									'User-Agent':'SomethingSomethingTest',
									'CB-ACCESS-KEY': api.key,
									'CB-ACCESS-SIGN': hmac.update(w).digest('base64'),
									'CB-ACCESS-TIMESTAMP': ts,
									'CB-ACCESS-PASSPHRASE': api.pp
								},
							};
							
							request(options, function(err, response, body) {
								if(err) {
									console.log(err);
								} else {
									try {
										var json = JSON.parse(body);
										realProfit.lpp = parseFloat(json[0].price);
										realProfit.fees += parseFloat(json[0].fee);
										mostFitBot.currentHoldings.eth = realProfit.amount;
										mostFitBot.currentHoldings.lastPurchasePrice = realProfit.lpp;
									} catch (e) {
										console.log("Exception caught: " + e);
									}
								}
							});
						}, 3000);
				}, 3000);
				} catch(e) {
					console.log("Exception caught: " + e);
				}
			}
		});
	} else {
		console.log("Cannot complete trade - Live trading has been stopped");
	}
}

function postSell() {
	if(allowLive) {
		var ts = (Date.now() / 1000).toString();
		var rp = "/orders";
		var method = "POST";
		var b = JSON.stringify({
			type: "market",
			product_id: currencyToTrade,
			side: "sell",
			size: purchaseThreshhold.toString()
		});
		var w = ts + method + rp + b;
		var k = Buffer(api.sc, 'base64');
		var hmac = crypt.createHmac('sha256', k);
		var options = {
			url: "https://api.gdax.com/orders",
			method: "POST",
			headers: {
					'User-Agent':'SomethingSomethingTest',
					'CB-ACCESS-KEY': api.key,
					'CB-ACCESS-SIGN': hmac.update(w).digest('base64'),
					'CB-ACCESS-TIMESTAMP': ts,
					'CB-ACCESS-PASSPHRASE': api.pp,
					'Accept' : 'application/json',
					'Content-Type': 'application/json',
			},
			body: b
		};
		request(options, function(err,response,body) {
			if(err) {
				console.log(err);
			} else {
				try {
					var json = JSON.parse(body);
					var fn = "saleLog-" + Date.now().toString() + ".txt";
					fs.writeFile(fn, JSON.stringify(json), function(err) {
						if(err) {
							console.log(err);
						} else {
							console.log("Sale recorded successfully");
						}
					});
					setTimeout(function() {
						getAccountInfo();
						setTimeout(function() {
							var ts = (Date.now() / 1000).toString();
							var rp = "/fills?product_id="+currencyToTrade;
							var method = "GET";
							var w = ts + method + rp;
							var k = Buffer(api.sc, 'base64');
							var hmac = crypt.createHmac('sha256', k);
							
							var options = {
								url: "https://api.gdax.com/fills?product_id="+currencyToTrade,
								headers: {
									'User-Agent':'SomethingSomethingTest',
									'CB-ACCESS-KEY': api.key,
									'CB-ACCESS-SIGN': hmac.update(w).digest('base64'),
									'CB-ACCESS-TIMESTAMP': ts,
									'CB-ACCESS-PASSPHRASE': api.pp
								},
							};
							
							request(options, function(err, response, body) {
									if(err) {
										console.log(err);
									} else {
										try {
											var json = JSON.parse(body);
											realProfit.fees += parseFloat(json[0].fee);
											realProfit.accumulated += ((purchaseThreshhold) * parseFloat(json[0].price)) - (realProfit.lpp * purchaseThreshhold);
											realProfit.lpp = 0;
											realProfit.amount -= purchaseThreshhold;
											mostFitBot.currentHoldings.eth = realProfit.amount;
											mostFitBot.currentHoldings.profit = realProfit.accumulated;
											
										} catch (e) {
											console.log("Exception caught: " + e);
										}
									}
								});
							}, 3000);
						}, 3000);
				} catch(e) {
					console.log("Exception caught: " + e);
				}
			}
		});
	} else {
		console.log("Cannot complete trade - Live trading has been stopped");
	}
}

function calculateRSI(step) {
	var ups = [];
	var downs = [];
	var sma_up = 0;
	var sma_down = 0;
	var rs = 0;
	var rsi = 0;
	for(var i=1; i<latestValues.tradeData[step.toString()].length; i++) {
		if(latestValues.tradeData[step.toString()][i][4] > latestValues.tradeData[step.toString()][i-1][4]) {
			ups.push(latestValues.tradeData[step.toString()][i][4] - latestValues.tradeData[step.toString()][i-1][4]);
			downs.push(0);
		}
		else if(latestValues.tradeData[step.toString()][i][4] < latestValues.tradeData[step.toString()][i-1][4]) {
			ups.push(0);
			downs.push(latestValues.tradeData[step.toString()][i-1][4] - latestValues.tradeData[step.toString()][i][4]);
		}
		else {
			ups.push(0);
			downs.push(0);
		}
	}
	for(var j in ups) {
		sma_up += ups[j];
	}
	sma_up /= ups.length;
	for(var k in downs) {
		sma_down += downs[j];
	}
	sma_down /= downs.length;
	rs = sma_up / sma_down;
	rsi = 100 - (100 / (1 + rs));
	latestValues.rsi[step.toString()] = rsi;
}

function calcAvgFromData(step) {
	var a = 0;
	for(var i in latestValues.tradeData[step.toString()]) {
		a += latestValues.tradeData[step.toString()][i][4];
	}
	a /= latestValues.tradeData[step.toString()].length;
	latestValues.average[step.toString()] = a;
}

function calcStdDevFromData(step) {
	var s = 0;
	calcAvgFromData(step);
	for(var i in latestValues.tradeData[step.toString()]) {
		s += Math.sqrt(Math.abs(latestValues.tradeData[step.toString()][i][4] - latestValues.average[step.toString()]));
	}
	s /= latestValues.tradeData[step.toString()].length;
	s = Math.sqrt(s);
	latestValues.stddev[step.toString()] = s;
}

function calcAvg(data) {
	var a = 0;
	for(var i in data) {
		a += data[i];
	}
	a /= data.length;
	return a;
}

function calcStdDev(data) {
	var s = 0;
	var a = calcAvg(data);
	for(var i in data) {
		s += Math.sqrt(Math.abs(data[i] - a));
	}		
	s /= data.length;
	s = Math.sqrt(s);
	return s;
}

function calcCCI(step) {
	var pt = [];
	for(var i in latestValues.tradeData[step.toString()]) {
		pt.push( (latestValues.tradeData[step.toString()][i][1] + latestValues.tradeData[step.toString()][i][2] + latestValues.tradeData[step.toString()][i][4]) / 3 );
	}
	var a = calcAvg(pt);
	var s = calcStdDev(pt);
	latestValues.cci[step.toString()] = ( (1 / 0.015) * ( (pt[pt.length-1] - a) / s) );
}

function calcBollingerBands(step) {
	calcStdDevFromData(step);
	latestValues.bolBands[step.toString()].upper = latestValues.average[step.toString()] + (1.5*latestValues.stddev[step.toString()]);
	latestValues.bolBands[step.toString()].middle = latestValues.average[step.toString()];
	latestValues.bolBands[step.toString()].lower = latestValues.average[step.toString()] - (1.5*latestValues.stddev[step.toString()]);
}

function makeBollingerBandDecision(step) {
	calcBollingerBands(step);
	
	if(latestValues.price > latestValues.bolBands[step.toString()].upper) {
		indicators.bollinger[step.toString()] = "sell";
		indicators.r_bollinger[step.toString()] = "buy";
	}
	else if(latestValues.price < latestValues.bolBands[step.toString()].lower) {
		indicators.bollinger[step.toString()] = "buy";
		indicators.r_bollinger[step.toString()] = "sell";
	}
	else {
		indicators.bollinger[step.toString()] = "hold";
		indicators.r_bollinger[step.toString()] = "hold";
	}
}

function makeRSIDecision(step) {
	calculateRSI(step);
	if(latestValues.rsi[step.toString()] >= 70) {
		indicators.rsi[step.toString()] = "sell";
		indicators.r_rsi[step.toString()] = "buy";
	}
	else if(latestValues.rsi[step.toString()] <= 30) {
		indicators.rsi[step.toString()] = "buy";
		indicators.r_rsi[step.toString()] = "sell";
	}
	else {
		indicators.rsi[step.toString()] = "hold";
		indicators.r_rsi[step.toString()] = "hold";
	}
}

function makeSMACrossoverDecision(step) {
	calcAvgFromData(step);
	if(latestValues.price > latestValues.average[step.toString()] && latestValues.smaBelow[step.toString()]) {
		latestValues.smaBelow[step.toString()] = false;
		indicators.sma_crossover[step.toString()] = "buy";
		indicators.r_sma_crossover[step.toString()] = "sell";
	} else if(latestValues.price < latestValues.average[step.toString()] && !latestValues.smaBelow[step.toString()]) {
		latestValues.smaBelow[step.toString()] = true;
		indicators.sma_crossover[step.toString()] = "sell";
		indicators.r_sma_crossover[step.toString()] = "buy";
	} else if(latestValues.price < latestValues.average[step.toString()]) {
		latestValues.smaBelow[step.toString()] = true;
		indicators.sma_crossover[step.toString()] = "hold";
		indicators.r_sma_crossover[step.toString()] = "hold";
	} else if(latestValues.price > latestValues.average[step.toString()]) {
		latestValues.smaBelow[step.toString()] = false;
		indicators.sma_crossover[step.toString()] = "hold";
		indicators.r_sma_crossover[step.toString()] = "hold";
	} else {
		indicators.sma_crossover[step.toString()] = "hold";
		indicators.r_sma_crossover[step.toString()] = "hold";
	}
}

function makeCCIDecision(step) {
	calcCCI(step);
	if(latestValues.cci[step.toString()] >= 100) {
		indicators.cci[step.toString()] = "buy";
		indicators.r_cci[step.toString()] = "sell";
	} else if(latestValues.cci[step.toString()] <= -100) {
		indicators.cci[step.toString()] = "sell";
		indicators.r_cci[step.toString()] = "buy";
	} else {
		indicators.cci[step.toString()] = "hold";
		indicators.r_cci[step.toString()] = "hold";
	}
}
//Consider remaking these functions
function createNewPopulation() {
	for(var i=50; i<100; i++) {
		bots[i] = Bot();
		bots[i].createRandomGenome();
	}
}
//Consider remaking these functions
function createNewGeneration() {
		
	for(var i=0; i<50; i++) {
		bots[i] = Bot();
		bots[i].copyGenome(mostFitBot.genes);
		bots[i].mutate();
	}
}

function evaluateFitness() {
	var bestBot;
	var maxProfit = 0;
	
	if(allowLive) {
		realProfit.total += realProfit.accumulated;
		if(realProfit.total < lossThreshold || realProfit.accumulated < lossThreshold) {
			allowLive = false;
		}
	}
	realProfit.accumulated = 0;
	if(mostFitBot !== undefined) {
		accumulatedProfit += mostFitBot.currentHoldings.profit;
	}
	data = "" + Date().toString() + "," + generation.toString() + "," + (realProfit.total - realProfit.fees).toString() + "," + realProfit.accumulated.toString() + "\n";
	fs.appendFile(filename,data,function(err) {
		if(err) { 
			console.log("Exception caught: " + err);
		} else {
			console.log("Generation " + generation.toString() + " data recorded successfully.");
		}
	});
	
	for(var i in bots) {
		if(bots[i].currentHoldings.profit > maxProfit) {
			maxProfit = bots[i].currentHoldings.profit;
			bestBot = bots[i];
		}
	}
	if(mostFitBot !== undefined && bestBot !== undefined && (mostFitBot.currentHoldings.profit > bestBot.currentHoldings.profit)) {
		bestBot = mostFitBot;
	}
	if(bestBot == undefined && mostFitBot !== undefined) {
		if(mostFitBot.currentHoldings.profit > 0) { 
			bestBot = mostFitBot;
		}
	}
	
	if(bestBot !== undefined) {
		mostFitBot = bestBot;
		if(allowLive) {
			mostFitBot.live = true;
			mostFitBot.currentHoldings.eth = realProfit.amount;
			mostFitBot.currentHoldings.lastPurchasePrice = realProfit.lpp;
		} else {
			mostFitBot.currentHoldings.eth = holdings.eth;
			mostFitBot.currentHoldings.lastPurchasePrice = holdings.lastPurchasePrice;
		}
		mostFitBot.currentHoldings.profit = 0;
		createNewGeneration();
		createNewPopulation();
	} else {
		if(mostFitBot !== undefined) {
			holdings.eth = mostFitBot.currentHoldings.eth;
			holdings.lastPurchasePrice = mostFitBot.currentHoldings.lastPurchasePrice;
		}
		mostFitBot = undefined;
		for(var b in bots) {
			bots[b] = new Bot();
			bots[b].createRandomGenome();
		}
	}
	generation += 1;
}

function loop() {
	getTradeData(60, function(data) {
		setTimeout(function() {
				getTradeData(300, function(data) {
					setTimeout(function() {
						getTradeData(900, function(data) {
							setTimeout(function() {
								getPrice(function(price) {
									makeBollingerBandDecision(60);
									makeSMACrossoverDecision(60);
									makeRSIDecision(60);
									makeCCIDecision(60);
									makeBollingerBandDecision(300);
									makeSMACrossoverDecision(300);
									makeRSIDecision(300);
									makeCCIDecision(300);
									makeBollingerBandDecision(900);
									makeSMACrossoverDecision(900);
									makeRSIDecision(900);
									makeCCIDecision(900);
									console.log("Generation: " + generation + " Time: " + Date());
									if(allowLive) {
										console.log("Total Real Profit: $" + ((realProfit.accumulated + realProfit.total) - realProfit.fees) );
									} else {
										console.log("Total Simulated Profit: $" + accumulatedProfit);
									}
									if(mostFitBot !== undefined) {
										mostFitBot.ruleset();
										mostFitBot.makeTradeDecision();
										setTimeout(function() {
											if(allowLive) {
												console.log("Most Fit Bot(LIVE): " + "[Current Decision: " + mostFitBot.decision + "]\t" + currencyToTrade + ": " + realProfit.amount + "\tLPP: " + realProfit.lpp + "\tProfit: "  + (realProfit.accumulated + realProfit.total - realProfit.fees).toString());
											} else {
												console.log("Most Fit Bot(SIMULATED): " + "[Current Decision: " + mostFitBot.decision + "]\t" + currencyToTrade + ": " + mostFitBot.currentHoldings.eth + "\tLPP: " + parseFloat(mostFitBot.currentHoldings.lastPurchasePrice).toPrecision(7) + "\tProfit: "  + mostFitBot.currentHoldings.profit);
											}
											for(var y=0; y<mostFitBot.genes.length; y++) {
												console.log("\t" + mostFitBot.genes[y].func.name + mostFitBot.genes[y].step.toString() + ": " + genePool[mostFitBot.genes[y].func.name](mostFitBot.genes[y]["step"]));
											}
										}, 3000);
									}
									for(var v in bots) {
										bots[v].ruleset();
										bots[v].makeTradeDecision();
										console.log("Bot " + v + " [Current Decision: " + bots[v].decision + "]\t" + currencyToTrade + ": " + bots[v].currentHoldings.eth + "\tLPP: " + parseFloat(bots[v].currentHoldings.lastPurchasePrice).toPrecision(7) + "\tProfit: " + bots[v].currentHoldings.profit );
										
										for(var x in bots[v].genes) {
											console.log("\t" + bots[v].genes[x].func.name + bots[v].genes[x].step.toString() + ": " + genePool[bots[v].genes[x].func.name](bots[v].genes[x]["step"]));
										}
										
									}
									console.log("\n");
									if(!allowLive) {
										console.log("**ALERT: Live Trading has been stopped.\n");
									}
								});
							}, 3000);
						});
					}, 3000);
				});
		},3000);
	});
}

function setup() {

	for(var v=0; v<100; v++) {
		bots[v] = Bot();
		bots[v].createRandomGenome();
	}
	
	var temp;
	fs.readFile("template.csv", function(err,data) {
		if(err) {
			console.log("Exception caught: " + err);
		} else {
			temp = data;
			filename = "log-" + startTime.toString() + ".csv";
			fs.writeFile(filename, temp, function(err) {
				if(err) {
					console.log("Exception caught: " + err);
				} else {
					console.log("Log file for this session created: " + filename);
				}
			});
		}
	});
	
	fs.readFile("key.json", function(err,data) {
		if(err) {
			console.log("Exception caught: " + err);
		} else {
			api = JSON.parse(data);
			console.log(api);
			getAccountInfo();
		}
	});
	
	setInterval(loop, 15000);
	setInterval(evaluateFitness, 5400000);
}

setup();

http.createServer(function(req, res) {
	var method = req.method;
	var q = url.parse(req.url, true);
	var fn = "." + q.pathname;
	if(method == "GET") {
		if(q.pathname == "/") {
			fs.readFile("index.html", function(err,data) {
				if(err) {
				res.writeHead(404, {'Content-Type': 'text/html'});
				res.end();
			} else {
				res.writeHead(200, {'Content-Type': 'text/html'});
				res.write(data);
				res.end();
			}
			});
		} else if(q.pathname == '/getData') {
			console.log("client request");
			var trading;
			var p;
			if(mostFitBot !== undefined) {
				trading = "Live";
				p = mostFitBot.currentHoldings.lastPurchasePrice;
			} else {
				trading = "Not Live";
				p = holdings.lastPurchasePrice;
			}
			var pack = {
						profit: realProfit.total + realProfit.accumulated - realProfit.fees,
						tradeStatus: trading, 
						generation: generation, 
						lastPrice: p,
						tradingCurrency: currencyToTrade, 
						purchaseAmt: purchaseThreshhold
						};
			res.writeHead(200, {'Content-Type': 'text/html'});
			res.write(JSON.stringify(pack));
			res.end();
		} else if(q.pathname == '/update/') {
			console.log("update request");
			try {
				var live = q.query.live;
				var purchaseAmt = parseFloat(q.query.purchaseAmt);
				var currency = q.query.currency;
				if(live == "Yes") {
					allowLive = true;
				} else {
					allowLive = false;
					if(mostFitBot !== undefined) {
						mostFitBot.live = false;
					}
				}
				purchaseAmt = purchaseThreshhold;
				currencyToTrade = currency;
				res.writeHead(200, {'Content-Type': 'text/html'});
				var pack = {result: true}
				res.write(JSON.stringify(pack));
				res.end();
			} catch(e) {
				console.log("exception caught: " + e);
				res.writeHead(200, {'Content-Type': 'text/html'});
				var pack = {result: false}
				res.write(JSON.stringify(pack));
				res.end();
			}
		} else {
			console.log(q.pathname);
			fs.readFile(fn, function(err, data) {
				if(err) {
					res.writeHead(404, {'Content-Type': 'text/html'});
					res.end();
				} else {
					res.writeHead(200, {'Content-Type': 'text/html'});
					res.write(data);
					res.end();
				}
			});
		}
	}
}).listen(port, function() {
	console.log("Server listening on port " + port);
});
/// <reference types="node" />

const EventEmitter = require('events');

function indent (arr: string[], indentLevel: number = 0, char: string = '\t') : string {
	const str = char.repeat(indentLevel);

	return arr.map(val => str + val).join('\n');
}

function randomIndex (length: number) : number {
	return Math.floor(Math.random() * length);
}


interface State {
	to: Function[],
	from: Function[],
	set: Function[],
	unset: Function[]
}

type Info = [boolean, string?]; // for returning if it succeeded and suggested text to send

type BlackCardData = (string | number)[];

type WhiteCardData = string;

interface StoredCards {
	black: BlackCardData[];
	white: WhiteCardData[];

	name: string;
}

interface FSM_TriggerCallback_General {
	(self: FSM, stateName: string, transformName: string, ...args: any[]) : boolean | void;
}

interface FSM_TriggerCallback_From extends FSM_TriggerCallback_General {
	(self: FSM, stateName: string, transformName: string, toState: string, ...args: any[]) : boolean | void;
}

interface FSM_TriggerCallback_To extends FSM_TriggerCallback_General {} // no difference

class FSM {
	states: {
		[propName: string]: State
	};
	state: string;

	constructor () {
		this.states = {};
		this.state = null;
		
		this.addState('INIT')
			.setToTransform('INIT', () => Object.keys(this.states).length === 1); // only allow transformation to this if it is the only state

		this.setState('INIT');
	}

	setState (name : string, forceFrom : boolean = false, forceTo : boolean = false) : boolean {
		if (!this.findState(name)) {
			console.warn("Can't find state with name of:", name);
			return false;
		}

		if (this.state && !forceFrom) {
			const stateAllows : boolean = this.trigger(this.state, 'from', name)
				.reduce((prev : boolean, cur : boolean) : boolean => { // if any of the previous state conditions disagrees on moving it, then don't move it
					if (typeof(cur) === 'boolean') {
						return prev && cur;
					}

					return prev;
				}, true);

			if (!stateAllows) {
				return false;
			}
		}

		const futureState : boolean = this.trigger(name, 'to')
			.reduce((prev : boolean, cur : boolean) : boolean => {
				if (typeof(cur) === 'boolean') {
					return prev && cur;
				}

				return prev;
			}, true);

		if (!forceFrom && !futureState) {
			return false;
		}


		if (this.state) {
			this.trigger(this.state, 'unset', name);
		}

		let tempLastState : string = this.state;
		this.state = name;

		this.trigger(this.state, 'set', tempLastState);
		
		return true;
	}

	trigger (stateName : string, transformName : string, ...args) : boolean[] {
		console.log('--- trigger ', stateName, transformName, args);
		return this.findState(stateName)[transformName].map(func => func(this, stateName, transformName, ...args));
	}

	addState (name : string) : this {
		if (this.findState(name)) {
			throw new Error("Already created that state");
		}
		
		this.states[name] = {
			to: [], // Conditions on whether it should be set. Ret true if it's passed, ret false if it hasn't
			from: [], // Conditions on whether it should be unset. Ret true if it's passed, ret false if it hasn't
			set: [], // Functions to run whenever this is set to be the current state
			unset: [], // Functions to run whenever this is set to be the current state
		};

		return this;
	}

	setToTransform (name : string, condition : FSM_TriggerCallback_To) : this {
		return this.setTransform("to", name, condition);
	}

	setFromTransform (name : string, condition : FSM_TriggerCallback_From) {
		return this.setTransform("from", name, condition);
	}

	setTransform (transformName : string, name : string, condition : FSM_TriggerCallback_General) {
		this.findState(name)[transformName].push(condition);

		return this;
	}

	findState (name) : State {
		return this.states[name];
	}
}

class Game extends FSM {
	host : Player;
	tsar : Player;
	players : Player[];

	cards : CardCollection;
	blackCard : BlackCard;

	settings: {
		maxCards: number;
		maxPoints: number;
	};

	constructor () {
		super();

		this.host = null; // Player
		this.tsar = null; // Player
		this.players = [];

		this.cards = new CardCollection();
		this.blackCard = null;

		this.settings = {
			maxCards: 10, // Maximum amount of cards in a players hand
			maxPoints: 10,
		};

		this.addState("KILLED") // in the other fromTransform functions, no need to check for KILLED as it is forced onto the system.
			.setToTransform("KILLED", () => this.players.length === 0)
			.setFromTransform("KILLED", () => false) // can't change from being killed
			.setTransform("set", "KILLED", () => {
				this.host = null;
				this.tsar = null;
				this.players = null;
				this.cards = null;
			})
			.setTransform("unset", "KILLED", () => {
				throw new Error("Attemtping to convert killed game object into non-killed game object, apparently. Bugger off.");
			});
		
		this.addState("EMPTY")
			.setFromTransform("EMPTY", (_, __, ___, to) => {to === "WAITING"});
		
		this.addState("WAITING")
			.setToTransform("WAITING", () => this.players.length >= 1)
			.setTransform("set", "WAITING", () => {
				this.players.forEach(player => player.cards = []); // clear each players cards. Only has an effect if they were playing the game then ran out of players
				// might not be needed. should test to see if it the game runs without bugs with this removed
			})
		
		this.addState("DEALING") // a mid-state between WAITING & PlAYING and PLAYING & INBETWEENTURN & TSARTURN
			.setToTransform("DEALING", () => this.state === "WAITING" || this.state === "PLAYING" || this.state === "INBETWEENTURN" || this.state === "TSARTURN")
			.setTransform("set", "DEALING", () => {
				// give players cards
				console.log('--- dealing cards');
				this.tsar = this.players[randomIndex(this.players.length)];
				this.players.forEach(player => player.fillCards(this.settings.maxCards, this.cards));
				this.blackCard = this.cards.getRandomBlackCard(true);
			});
		
		this.addState("PLAYING")
			.setToTransform("PLAYING", () => this.players.length >= 3)
			.setFromTransform("PLAYING", (_, _1, _2, to) => to === "WAITING" || to === "INBETWEENTURN");
		
		this.addState("INBETWEENTURN")
			.setToTransform("INBETWEENTURN", () => this.state === "PLAYING")
			.setFromTransform("INBETWEENTURN", (_, __, ___, to) => to === "TSARTURN");

		this.addState("TSARTURN")
			.setToTransform("TSARTURN", () => this.state === "INBETWEENTURN")
			.setFromTransform("TSARTURN", (_, __, ___, to) => to === "DEALING");	
	}

	isTsar (player : Player) : boolean {
		return this.tsar === player;
	}

	chooseWinnerByIndex (tsar : Player, index : number = -1) : Info {
		if (this.tsar !== tsar) {
			return [false, "You can't choose, you're not the Tsar."];
		}

		if (this.state !== "TSARTURN") {
			return [false, "It's not currently the time to choose!"];
		}

		let choices = this.getFilledInCardsWithPlayer();

		if (index < 0 || index > choices.length - 1) {
			return [false, "That's not a valid card."];
		}

		let choice : [Player, string] = choices[index];

		choice[0].points++;
		
		return [true];
	}

	donePlaying () : boolean {
		for (let i = 0; i < this.players.length; i++) {
			if (!this.isTsar(this.players[i])) {
				if (this.players[i].played.length !== this.blackCard.getFillCount()) {
					return false;
				}
			}
		}

		return true;
	}

	getFilledInCardText () : string[] {
		return this.players
			.filter(player => !this.isTsar(player))
			.map((player : Player) : string => this.blackCard.getDisplay(true, ...player.played.map(index => player.cards[index])));
	}

	getFilledInCardsWithPlayer () : Array<[Player, string]> {
		return this.players
			.filter(player => !this.isTsar(player))
			.map((player : Player) : [Player, string] => 
					[
						player, 
						this.blackCard.getDisplay(true, ...player.played.map(index => player.cards[index]))
					]
			);
	}

	play (player : Player, card : WhiteCard) : Info {
		return this.playByCardIndex(player, player.cards.indexOf(card));
	}

	playByCardIndex (player : Player, index : number) : Info {
		if (this.state !== 'PLAYING') {
			return [false, "You can't play a card right now."];
		}

		if (this.isTsar(player)) {
			return [false, "The Tsar cannot play a card."];
		}

		if (player.played.length >= this.blackCard.getFillCount()) {
			return [false, "You have already played the max amount of cards."];
		}

		if (player.cards.length < index || !(player.cards[index] instanceof WhiteCard)) {
			return [false, "That card does not exist."];
		}

		player.played.push(index);

		if (this.donePlaying()) {
			this.setState('INBETWEENTURN');
			this.setState('TSARTURN');
		}

		return [true];
	}

	kill () : void {
		this.setState("KILLED", true, true);
	}

	start () : Info {
		if (this.state !== 'WAITING') {
			return [false, "The game is not currently waiting to be started."];
		}

		console.log("SET TO DEALING: ", this.setState("DEALING"));
		console.log("SET TO PLAYING: ", this.setState("PLAYING"));

		return [true];
	}

	addPlayer (player : Player) : void {
		// TODO: add a player limit
		this.players.push(player);

		this.findHost();

		if (this.state === 'EMPTY') {
			this.setState('WAITING');
		}

		if (this.state !== 'WAITING' && this.state !== 'EMPTY') { // basically if the game is playing
			this.players[this.players.length - 1].fillCards(this.settings.maxCards, this.cards);
		}
	}

	removePlayer (player : Player) : Info {
		return this.removePlayerByIndex(this.players.indexOf(player));
	}

	removePlayerByIndex (index : number = -1) : Info {
		if (index !== -1) {
			if (index < this.players.length) {
				let player : Player = this.players[index];

				this.players.splice(index, 1);

				if (this.host === player) {
					this.host = null;

					this.findHost();
				}

				if (this.state === 'PLAYING') {
					this.setState("WAITING");
				}

				return [true, "Removed Played"];
			} else {
				console.warn("Trying to remove player by index out of range", index);
				return [false, "I can't find that player."];
			}
		}

		console.warn("Trying to remove player by index that doesn't exist :c", index); 
		return [false, "I can't find that player..."];
	}

	findHost () : boolean {
		if (this.host === null || !this.players.includes(this.host)) {
			if (this.players.length === 0) {
				// game is empty, kill it.
				this.kill();

				return false;
			} else {
				this.host = this.players[0];
				return true;
			}
		}

		return false; // no need to change
	}
	
	static create (host : Player) : Game {
		let game : Game = new Game();

		game.addPlayer(host);
		game.setState('WAITING');

		return game;
	}

	toString (indentLevel : number = 0) : string {
		return indent([
			'Game', 
			indent([
				'state: ' + this.state, 
				'host: ' + (this.host instanceof Player ? this.host.toString(indentLevel + 1) : this.host), 
				'tsar: ' + this.tsar, 
				'cards: ' + this.cards.toString(indentLevel + 2)], indentLevel + 1),
			"Players",
			...(this.players.map(player => player.toString(indentLevel + 1)))
		], indentLevel);
	}
}

class Player {
	id : string;

	cards: WhiteCard[];
	played: number[];

	points: number;

	constructor (id : string) {
		this.id = id; // trip, hash, whatever want to use
		
		this.cards = [];
		this.played = []; // array of indexes

		this.points = 0;
	}

	fillCards (maxCards : number = 10, col : CardCollection) : boolean {
		let difference : number = maxCards - this.cards.length;
		
		console.log('--- Player ' + this.id + ' was missing ' + String(difference) + ' cards.');

		for (let i = 0; i < difference; i++) {
			this.cards.push(col.getRandomWhiteCard(true));
		}	

		return true;
	}

	static create (id : string) : Player {
		return new Player(id);
	}

	toString (indentLevel : number = 0) : string {
		return indent([
			this.id + ' | Cards: ', 
			...this.cards.map(card => card.toString(1))
		], indentLevel);
	}
}

class WhiteCard {
	text : string;

	constructor (text : string) {
		this.text = text; // string
	}

	clone () : WhiteCard {
		return WhiteCard.create(this.text); // no need to do any fancy clothing, as strings aren't refernces
	}

	getDisplay () : string {
		return this.text;
	}

	static create (data : string) : WhiteCard {
		return new WhiteCard(data);
	}

	toString (indentLevel) {
		return indent([this.text], indentLevel);
	}
}

class BlackCard {
	text: (string | number)[];

	constructor (text : (string | number)[]) {
		this.text = text;
	}

	clone () : BlackCard {
		return BlackCard.create([...this.text]);
	}

	getFillSpots () : number[] {
		let values : number[] = <number[]>this.text.filter(item => typeof(item) === 'number');
		
		return [...new Set(values)]; // removes duplicates
	}
	
	getFillCount () : number {
		return this.getFillSpots().length;
	}

	getDisplay (fillIn : boolean = false, ...cards : WhiteCard[]) : string {
		if (fillIn) {
			return this.text.map((val : (string | number)) : string => {
				if (typeof(val) === 'number') {
					let card : WhiteCard = cards[val];

					if (val > cards.length - 1) {
						throw new RangeError("Too few cards given to BlackCard#getDisplay");
					}

					if (card instanceof WhiteCard) {
						return card.getDisplay();
					} else {
						throw new TypeError("Card given to BlackCard#getDisplay was not a White Card");
					}
				}
				
				return val;
			}).join('');
		} else {
			return this.text.map((val) : string => {
				if (typeof(val) === 'number') {
					return '___' + String(val) + '___';
				}

				return val;
			}).join('');
		}
	}

	static create (data : (string | number)[]) : BlackCard {
		return new BlackCard(data);
	}

	toString (indentLevel : number = 0) : string {
		return indent([this.getDisplay()], indentLevel);
	}
}

class CardCollection {
	name : string;
	
	white: WhiteCard[];
	black: BlackCard[];

	from: CardCollection[];

	constructor (white : WhiteCard[] = [], black : BlackCard[] = [], name : string = '<Unnamed>') {
		if (!Array.isArray(white)) {
			white = [];
		}

		if (!Array.isArray(black)) {
			black = [];
		}

		this.name = name;

		this.white = white;
		this.black = black;
		this.from = [];
	}

	getRandomWhiteCard (clone: boolean = true) : WhiteCard {
		return <WhiteCard>this.getRandomCard("white", clone);
	}

	getRandomBlackCard (clone: boolean = true) : BlackCard {
		return <BlackCard>this.getRandomCard("black", clone);
	}

	getRandomCard (color : ("white" | "black") = "white", clone : boolean = true) : WhiteCard | BlackCard {
		let card : (WhiteCard | BlackCard) = this[color][randomIndex(this[color].length)];

		if (card) {
			if (clone) {
				return card.clone();
			} else {
				return card;
			}
		}

		return null;
	}

	clone () : CardCollection {
		let col = new CardCollection(
			this.white
				.map(card => card.clone()), 
			this.black.map(card => card.clone()), this.name
		);

		col.from = [...this.from]; // clone it, essentially

		return col;
	}

	merge (col : CardCollection) : boolean {
		if (this.from.includes(col)) {
			return false;
		}

		this.white = this.white.concat(...col.white);
		this.black = this.black.concat(...col.black);

		this.from.push(col);

		return true;
	}

	unmerge (col : CardCollection, force : boolean = false) : boolean { // very inefficient
		if (!this.from.includes(col) && !force) {
			return false; // it's not in the from.
		}

		let whiteFound : WhiteCard[] = [];

		for (let i = 0; i < col.white.length; i++) {
			const card = col.white[i];

			if (this.white.includes(card)) {
				whiteFound.push(card);
			}
		}

		whiteFound.forEach(card => this.white.splice(this.white.indexOf(card), 1)); 


		let blackFound : BlackCard[] = [];

		for (let i = 0; i < col.black.length; i++) {
			const card = col.black[i];

			if (this.black.includes(card)) {
				blackFound.push(card);
			}
		}

		blackFound.forEach(card => this.black.splice(this.black.indexOf(card), 1)); 

		return true;
	}
 
	static create (data : StoredCards) : CardCollection {
		let col = new CardCollection();

		if (Array.isArray(data.black)) {
			col.black.push(...data.black.map(text => BlackCard.create(text)));
		}

		if (Array.isArray(data.white)) {
			col.white.push(...data.white.map(text => WhiteCard.create(text)));
		}

		if (typeof(data.name) === 'string') {
			col.name = data.name;
		}

		return col;
	}

	toString (indentLevel : number = 0) : string {
		return indent([
			'\n' + '\t'.repeat(indentLevel) + "Collection: '" + this.name + "'", 
			"Black Cards: [",
			...this.black.map(card => card.toString(1)),
			"]", 
			"White Cards: [",
			...this.white.map(card => card.toString(1)),
			"]", 
		], indentLevel);
	}
}

module.exports = {
	Game,

	Player,

	WhiteCard,
	BlackCard,

	CardCollection,
};
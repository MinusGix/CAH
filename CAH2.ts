/// <reference types="node" />

const EventEmitter = require('events');

interface MainConfiguration {
	Game: {
		settingsInfo: GameSettings<string>;
		maxSettings: GameSettings<number>;
		defaultSettings: GameSettings<number>;
		minSettings: GameSettings<number>;
	}
}

// Global Settings
let InternalConfig : MainConfiguration = {
	Game: {
		settingsInfo: {
			playerCards: "The amount of cards a player can have in their hand. Their hand is filled up to this much at the beginning of every turn.",
			winPoints: "The amount of points needed to be a winner of the game.",
			gamePlayerCount: "The amount of players allowed in the game.",
		},
		maxSettings: {
			playerCards: 20, // Too many cards and it can take too long to even find the right cards to play, or it would be too easy.
			winPoints: 30, // Too much and the game would just go on forever.
			gamePlayerCount: 10, // Depends on what this is being used in.
		},
		defaultSettings: {
			playerCards: 10, // Maximum amount of cards in a players hand
			winPoints: 10, // The number of points to meet to win
			gamePlayerCount: 6, // The maximum amount of players allowed in the game. This can depend on what you're using this in. (Such as in a chat that has spam limiting, too many players could make the bot get caught by that)
		},
		minSettings: {
			playerCards: 3, // Many cards require 1 or 2 or 3 cards. There are ones that require more, but they're rarer. So 3 is reccomended amount
			winPoints: 1, // This should be at least 1, or weird things will happen. Since this is the minimum the points required to win is allowed to be set too
			gamePlayerCount: 3, // If you just had one player, then there's no one to play cards. Just two players is possible but boring.
		},
	}
};

// Indent it for printing to the console. The debugging output is likely to be reworked completely.
function indent (arr: string[], indentLevel: number = 0, char: string = '\t') : string {
	const str = char.repeat(indentLevel);

	return arr.map(val => str + val).join('\n');
}

// Gets a random index from a length. Array isn't given, but rather just a length.
function randomIndex (length: number) : number {
	return Math.floor(Math.random() * length);
}

// Copy the object. Shallow.
function simpleCopy<T>(obj: T) : T {
	return Object.assign({}, obj);
}

// only returns true if all of the booleans in the array are true
function combineBooleans (arr: boolean[]) {
	return arr.reduce((prev : boolean, cur: boolean) : boolean => {
		// Ignore anything that isn't a boolean. This lets functions return void
		if (typeof(cur) === 'boolean') {
			return prev && cur;
		}

		return prev;
	}, true);
}

// a State as used internally by the FSM class
interface State {
	to: FSM_TriggerCallback_To[],
	from: FSM_TriggerCallback_From[],
	set: FSM_TriggerCallback_Set[],
	unset: FSM_TriggerCallback_UnSet[]
}

type Info = [boolean, string?]; // for returning if it succeeded and suggested text to send

type BlackCardData = (string | number)[];

type WhiteCardData = string;

interface StoredCards {
	black: BlackCardData[];
	white: WhiteCardData[];

	name?: string;
}

// Why. I couldn't find an easy way to do this with replication. This doesn't have special funcs for set and unset as they don't get any extra parems
// (But then, State#to conditions don't either... Perhaps remove it at some time.)
interface FSM_TriggerCallback_General {
	(self: FSM, stateName: string, transformName: string, ...args: any[]) : boolean | void;
}

interface FSM_TriggerCallback_From extends FSM_TriggerCallback_General {
	(self: FSM, stateName: string, transformName: string, toState: string, ...args: any[]) : boolean | void;
}

interface FSM_TriggerCallback_To extends FSM_TriggerCallback_General {} // no difference

interface FSM_TriggerCallback_Set extends FSM_TriggerCallback_General {
	(self: FSM, stateName: string, transformName: string, lastState: string, ...args: any[]) : any;
}

interface FSM_TriggerCallback_UnSet extends FSM_TriggerCallback_General {
	(self: FSM, stateName: string, transformName: string, to: string, ...args: any[]) : any;
}

class FSM extends EventEmitter { // FiniteStateMachine - May not be completely true to the idea (as I haven't actually had to use a fsm before), but it's got states at least!
	states: {
		[propName: string]: State
	};
	state: string;

	constructor () {
		super();

		// [string]: state
		this.states = {};
		// current state's name.
		this.state = null;
		
		this.addState('INIT')
			.setToTransform('INIT', () => Object.keys(this.states).length === 1); // only allow transformation to this if it is the only state

		this.setState('INIT'); // default to INIT state
	}

	hasState (name) {
		return !!this.findState(name);
	}

	// Set the current state to `name`. 
	// `forceFrom` makes so the previous state doesn't get an option to refuse the transition. (Good for things like a state where the FSM has been KILLED (as in the Game class))
	// `forceTo` makes so the state you're trying to set to doesn't get an option to refuse the transition. 
	setState (name : string, forceFrom : boolean = false, forceTo : boolean = false) : boolean {
		if (!this.hasState(name)) {
			console.warn("Can't find state with name of:", name);

			this.emit("setState:non-exist-state", this, name);

			return false;
		}

		if (this.state && !forceFrom) { // if the state actually exists and we aren't ignoring it's `from` conditions
			// in it's own variable because putting a multi-line reduce into a single if statement is messy
			const stateAllows : boolean = combineBooleans(this.trigger(this.state, 'from', name))

			this.emit("setState:from", this, name, stateAllows);
			
			if (!stateAllows) {
				return false; // Sorry, the current state is maintaining its dictatorial control and not letting `name` take over.
			}
		}

		// Whether the future state is fine with the transition
		const futureState : boolean = combineBooleans(this.trigger(name, 'to'))
		
		this.emit("setState:to", this, name, futureState);
		
		if (!forceFrom && !futureState) {
			return false;
		}

		// if there is an actual state
		if (this.state) {
			this.trigger(this.state, 'unset', name);
			this.emit("state:leaving", this, this.state, name);
		}

		// for passing to trigger
		const tempLastState : string = this.state;

		this.state = name;

		this.trigger(this.state, 'set', tempLastState);
		this.emit("state:entering", this, this.state, tempLastState);
		
		return true;
	}

	trigger (stateName : string, transformName : string, ...args) : boolean[] {
		return this.findState(stateName)[transformName].map((func : FSM_TriggerCallback_General) => func(this, stateName, transformName, ...args));
	}

	addState (name : string) : this {
		if (this.hasState(name)) {
			throw new Error("Already created that state");
		}
		
		this.states[name] = {
			to: [], // Conditions on whether it should be set. Ret true if it's passed, ret false if it hasn't
			from: [], // Conditions on whether it should be unset. Ret true if it's passed, ret false if it hasn't
			set: [], // Functions to run whenever this is set to be the current state
			unset: [], // Functions to run whenever this is set to be the current state
		};

		this.emit("state:created", this, name);

		return this;
	}

	setToTransform (name : string, condition : FSM_TriggerCallback_To) : this {
		return this.setTransform("to", name, condition);
	}

	setFromTransform (name : string, condition : FSM_TriggerCallback_From) {
		return this.setTransform("from", name, condition);
	}

	setSetTransform (name : string, condition) { // what a wonderful name
		return this.setTransform("set", name, condition);
	}

	setUnSetTransform (name: string, condition) {
		return this.setTransform("unset", name, condition);
	}

	setTransform (transformName : string, name : string, condition : FSM_TriggerCallback_General) {
		this.findState(name)[transformName].push(condition);

		return this;
	}

	findState (name) : State {
		return this.states[name];
	}
}

interface GameSettings<T> {
	playerCards: T;
	winPoints: T;
	gamePlayerCount: T;
}

class Game extends FSM {
	host : Player;
	tsar : Player;
	players : Player[];

	cards : CardCollection;
	blackCard : BlackCard;

	settingsInfo: GameSettings<string>;

	maxSettings: GameSettings<number>;
	settings: GameSettings<number>;
	minSettings: GameSettings<number>;

	constructor () {
		super();

		this.host = null; // Player
		this.tsar = null; // Player
		this.players = [];

		this.cards = new CardCollection();
		this.blackCard = null;

		this.resetSettings();

		// The state for the game being killed off
		this.addState("KILLED") // in the other fromTransform functions, no need to check for KILLED as it is forced onto the system.
			.setToTransform("KILLED", () => this.players.length === 0) // what
			.setFromTransform("KILLED", () => false) // can't change from being killed
			.setSetTransform("KILLED", () => {
				this.host = this.tsar = this.players = this.cards = this.blackCard = this.settingsInfo = this.maxSettings = this.settings = this.minSettings = null;
			})
			.setUnSetTransform("KILLED", () => {
				throw new Error("Attempting to convert killed game object into non-killed game object, apparently.");
			});
		
		// Before even the host has joined
		this.addState("EMPTY")
			.setFromTransform("EMPTY", (_, __, ___, to) => to === "WAITING");
		
		// There's less than minimum players
		this.addState("WAITING")
			.setToTransform("WAITING", () => this.players.length >= 1)
			.setSetTransform("WAITING", () => {
				this.players.forEach(player => player.cards = []); // clear each players cards. Only has an effect if they were playing the game then ran out of players
				// might not be needed. should test to see if it the game runs without bugs with this removed
			})
		
		// The players cards are dealed and the tsar is chosen. Switched to PLAYING once it's done.
		this.addState("DEALING") // a mid-state between WAITING & PlAYING and PLAYING & INBETWEENTURN & TSARTURN
			.setToTransform("DEALING", () => this.state === "WAITING" || this.state === "PLAYING" || this.state === "INBETWEENTURN" || this.state === "TSARTURN")
			.setSetTransform("DEALING", () => {
				// give players cards
				this.removePlayersPlayedCards();
				this.fillAllPlayersCards();
				this.chooseTsar();
				this.chooseBlackCard();
				this.setState("PLAYING");
			});
		
		//  Players can play their cards during this turn.
		this.addState("PLAYING")
			.setToTransform("PLAYING", () => this.players.length >= 3)
			.setFromTransform("PLAYING", (_, _1, _2, to) => to === "WAITING" || to === "INBETWEENTURN");
		
		// Unused so far
		this.addState("INBETWEENTURN")
			.setToTransform("INBETWEENTURN", () => this.state === "PLAYING")
			.setFromTransform("INBETWEENTURN", (_, __, ___, to) => to === "TSARTURN");

		// The Tsar chooses their favorite of the choices
		this.addState("TSARTURN")
			.setToTransform("TSARTURN", () => this.state === "INBETWEENTURN")
			.setFromTransform("TSARTURN", (_, __, ___, to) => to === "DEALING");	

		this.addState("ENDGAME")
			.setToTransform("ENDGAME", () => this.state === "TSARTURN")
			.setFromTransform("ENDGAME", () => false);
	}

	resetSettings () : boolean {
		this.settingsInfo = simpleCopy(InternalConfig.Game.settingsInfo);

		this.maxSettings = simpleCopy(InternalConfig.Game.maxSettings);

		this.settings = simpleCopy(InternalConfig.Game.defaultSettings);

		this.minSettings = simpleCopy(InternalConfig.Game.minSettings);

		return true;
	}

	chooseBlackCard () : boolean {
		this.blackCard = this.cards.getRandomBlackCard(true);
		
		return true;
	}

	chooseTsar () : boolean {
		this.tsar = this.players[randomIndex(this.players.length)];

		return true;
	}

	fillAllPlayersCards () : boolean[] {
		return this.players.map(player => this.fillPlayersCards(player));
	}

	fillPlayersCards (player : Player) : boolean {
		return player.fillCards(this.settings.playerCards, this.cards);
	}

	removePlayersPlayedCards () : boolean[] {
		return this.players.map(player => this.removePlayerPlayedCards(player));
	}

	removePlayerPlayedCards (player: Player) : boolean {
		if (player.played.length > 0) {
			player.played.forEach(index => player.cards[index] = null);
			player.cards = player.cards.filter(card => card !== null);
			
			player.played = [];

			return true;
		}

		return false;
	}

	getPlayingPlayers () : Player[] {
		return this.players.filter(player => !this.isTsar(player));
	}

	isTsar (player : Player) : boolean {
		return this.tsar === player;
	}

	// The Tsar chooses the winner of *that round* by their index (on the black card choice list). TODO: change the name of this so it's not confusing winner of round and winner of game
	chooseTurnWinnerByIndex (tsar : Player, index : number = -1) : Info {
		if (!this.isTsar(tsar)) {
			return [false, "You can't choose, you're not the Tsar."];
		}

		if (this.state !== "TSARTURN") {
			return [false, "It's not currently the time to choose!"];
		}

		// get the choices now, so we don't do multiple calls to the function
		let choices = this.getFilledInCardsWithPlayer();

		if (index < 0 || index > choices.length - 1) {
			return [false, "That's not a valid card."];
		}

		let choice : [Player, string] = choices[index];

		// They got chosen by the tsar, so increase it by a point
		choice[0].points++;

		this.emit("game:tsar:choice", this, choice);

		// Check if there is a winner
		if(!this.checkWinner()) { // if there is no winner, then advance to the next turn
			this.setState("DEALING");
		}
		
		return [true];
	}

	// Check if there is a winner of the entire game
	checkWinner () : boolean {
		let winners = this.getWinners();

		if (winners.length > 1) {
			console.warn("[CAH] There was more than one winner at once, which is odd. Was max points somehow changed during play?");
		}

		if (winners.length === 0) {
			return false;
		}

		this.setState("ENDGAME", true, true);

		this.emit("game:game-winner", this, winners);

		return true;
	}

	// Get all the players that meet the point requirement
	getWinners () : Player[] {
		return this.players.filter(player => this.isWinner(player));
	}

	isWinner (player : Player) : boolean {
		return player.points === this.settings.winPoints;
	}

	// If all the players have played all of their cards. TODO: add a timer to this, or somewhere in the code so there's a turn limit
	donePlaying () : boolean {
		if (this.state !== "PLAYING") {
			return false;
		}

		let players = this.getPlayingPlayers();
		let fillCount = this.blackCard.getFillCount();

		for (let i = 0; i < players.length; i++) {
			if (this.players[i].played.length !== fillCount) {
				return false;
			}
		}

		return true;
	}

	getFilledInText (player : Player) : string {
		return this.blackCard.getDisplay(true, ...player.played.map(index => player.cards[index]));
	}
	
	// Gets the black cards text filled in with all the players cards (except the Tsar's)
	getFilledInCardText () : string[] {
		return this.getPlayingPlayers()
			.map((player : Player) : string => this.getFilledInText(player));
	}

	// Gets the black cards text filled in with all players cards, and the Player who had those cards. (Except the Tsar's). Sadly mostly repeat code from getFilledInCardText
	// Couldn't put them together because typescript was being annoying
	getFilledInCardsWithPlayer () : Array<[Player, string]> {
		return this.getPlayingPlayers()
			.map((player : Player) : [Player, string] => [player, this.getFilledInText(player)]);
	}

	// A Player plays a card, gets the card reference.
	play (player : Player, card : WhiteCard) : Info {
		return this.playByCardIndex(player, player.cards.indexOf(card));
	}

	// Player plays a card by index. 
	playByCardIndex (player : Player, index : number) : Info {
		if (this.state !== 'PLAYING') {
			return [false, "You can't play a card right now."];
		}

		if (this.isTsar(player)) {
			return [false, "The Tsar cannot play a card."];
		}

		// If the amount of cards they've already played exceeds the amount needed
		if (player.played.length >= this.blackCard.getFillCount()) {
			return [false, "You have already played the max amount of cards."];
		}

		// If the card doesn't exist
		if (player.cards.length <= index || !(player.cards[index] instanceof WhiteCard)) {
			return [false, "That card does not exist."];
		}

		player.played.push(index);

		// If all the players are done, then swap to the tsar's turn
		if (this.donePlaying()) {
			this.setState('INBETWEENTURN');
			this.setState('TSARTURN');
		}

		if (player.played.length === this.blackCard.getFillCount()) {
			this.emit("game:player:played-all-cards", this, player);
		}

		return [true];
	}

	// Kill the game into pieces
	kill () : boolean {
		return this.setState("KILLED", true, true);
	}

	// Start the game from it's waiting stage.
	start () : Info {
		if (this.state !== 'WAITING') {
			return [false, "The game is not currently waiting to be started."];
		}

		this.setState("DEALING");

		return [true];
	}

	// Add a new player
	addPlayer (player : Player) : Info {
		if (this.players.length >= this.settings.gamePlayerCount) {
			return [false, "There is already too many players."];
		}

		this.players.push(player);

		this.findHost();

		if (this.state === 'EMPTY') {
			this.setState('WAITING');
		}

		// TODO: make this check for specific states where people are allowed to join
		if (this.state !== 'WAITING' && this.state !== 'EMPTY') { // basically if the game is playing
			this.players[this.players.length - 1].fillCards(this.settings.playerCards, this.cards);
		}

		return [true];
	}

	// Remove a player by reference
	removePlayer (player : Player) : Info {
		return this.removePlayerByIndex(this.players.indexOf(player));
	}

	removePlayerByIndex (index : number = -1) : Info {
		// Check if the user is actually in the list. TODO: perhaps console.warn if the user doesn't exist, as it managed to get through everything else?
		if (index !== -1) {
			// Index is within range. TODO: look at this, it would allow indexes less than 0 that are not -1 in.
			if (index < this.players.length) {
				let player : Player = this.players[index];

				this.players.splice(index, 1);

				if (this.host === player) {
					this.host = null;

					this.findHost();
				}

				// the State 'WAITING' only allows it to be enabled if the players are less than three
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

	getPlayerCount () : number {
		return this.players.length;
	}

	hasPlayers () : boolean {
		return this.getPlayerCount() > 0;
	}

	hasHost () : boolean {
		return this.host !== null && this.players.includes(this.host); 
	}

	setHost (player: Player) : boolean {
		return this.setHostByIndex(this.players.indexOf(player));
	}

	setHostByIndex (index: number) : boolean {
		if (this.players[index] instanceof Player) {
			this.host = this.players[index];

			return true;
		}

		return false;
	}

	// Tries to acquire a host.
	findHost () : boolean {
		// If there is no host declared at all, or if the host is no longer in the game list.
		if (!this.hasHost()) {
			if (!this.hasPlayers()) {
				// game is empty, kill it.
				this.kill();

				return false;
			} else {
				// Just set it to the most recent user.
				this.setHostByIndex(0);

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

	// Create a string representation for debugging
	toString (indentLevel : number = 0) : string {
		return indent([
			'Game', 
			indent([ // indents it so it looks nicer
				'state: ' + this.state, // The current statename
				'host: ' + (this.host instanceof Player ? this.host.toString(indentLevel + 1) : this.host),  // If there's a host, then display them
				'tsar: ' + this.tsar.toString(indentLevel + 1), // Display the tsar. TODO: change this to a tsar.toString, as this.tsar is a Player
				'cards: ' + this.cards.toString(indentLevel + 2)], indentLevel + 1), // The cards the game has, indents them to look nice. TODO: Check if they have any cards, if not display a message
			"Players",
			...(this.players.map(player => player.toString(indentLevel + 1))) // adds all the players into the list, indented nicely
		], indentLevel);
	}
}

// The player class. Used to identify and manage them.
class Player {
	id : string;

	cards: WhiteCard[];
	played: number[];

	points: number;

	constructor (id : string) {
		// A unique identifier. Could be whatever program is using this wants. (Though, typescript only allows a string and this woudl have to 
		// modified to completely work with anything else)
		this.id = id; // trip, hash, whatever want to use
		
		// Their White Cards they have in their hand
		this.cards = [];
		// An array of indexes to `this.cards`
		this.played = []; // array of indexes

		// The player's points in the game.
		this.points = 0;
	}

	getCardIndex (card: WhiteCard) : number {
		return this.cards.indexOf(card);
	}

	removeCard (card: WhiteCard) : boolean {
		return this.removeCardByIndex(this.getCardIndex(card));
	}

	removeCardByIndex (index: number) : boolean {
		if (index === -1) {
			return false;
		}

		this.cards.splice(index, 1);

		return true;
	}

	getPlayedCount () : number {
		return this.played.length;
	}

	// Fills the players deck with cards randomly chosen from the games deck. TODO: handle cases where there is no cards, somewhere
	fillCards (playerCards : number = 10, col : CardCollection) : boolean {
		// The amount of cards that needs to be added
		let difference : number = playerCards - this.cards.length;

		for (let i = 0; i < difference; i++) {
			this.cards.push(col.getRandomWhiteCard(true));
		}	

		return true;
	}

	static create (id : string) : Player {
		return new Player(id);
	}

	// Pretty indentation debug string
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
		// Unlike the BlackCard this doesn't have any special chars, just a string.
		this.text = text; // string
	}

	clone () : WhiteCard {
		return WhiteCard.create(this.text); // no need to do any fancy clothing, as strings aren't refernces
	}

	// For displaying it to players
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
		// contains strings and numbers. The numbers are inputs
		this.text = text;
	}

	clone () : BlackCard {
		return BlackCard.create([...this.text]); // can do this to clone it as it's all strings/numbers
	}

	getFillSpots () : number[] {
		let values : number[] = <number[]>this.text.filter(item => typeof(item) === 'number');
		
		return [...new Set(values)]; // removes duplicates
	}
	
	getFillCount () : number {
		return this.getFillSpots().length;
	}

	getDisplay (fillIn : boolean = false, ...cards : WhiteCard[]) : string {
		if (fillIn) { // Fills the number spots with the cards text
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
			this.black
				.map(card => card.clone()), 
			this.name
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

	isFrom (col: CardCollection) {
		return this.from.includes(col);
	}

	hasCard (card : (BlackCard | WhiteCard)) : boolean {
		if (card instanceof WhiteCard) {
			return this.hasWhiteCard(card);
		} else if (card instanceof BlackCard) {
			return this.hasBlackCard(card);
		} else {
			throw new TypeError("Can not find a card, because that isn't a card.");
		}
	}

	getWhiteCardIndex (card: WhiteCard) : number {
		return this.white.indexOf(card);
	}

	hasWhiteCard (card: WhiteCard) : boolean {
		return this.getWhiteCardIndex(card) !== -1;
	}

	getBlackCardIndex (card: BlackCard) : number {
		return this.black.indexOf(card);
	}

	hasBlackCard (card) : boolean {
		return this.getBlackCardIndex(card) !== -1;
	}

	unmerge (col : CardCollection, force : boolean = false) : boolean { // very inefficient
		if (!this.isFrom(col) && force === false) {
			return false; // it's not from that col
		}

		let whiteFound : WhiteCard[] = [];

		for (let i = 0; i < col.white.length; i++) {
			const card = col.white[i];

			if (this.white.includes(card)) {
				whiteFound.push(card);
			}
		}

		whiteFound.forEach(card => this.white.splice(this.getWhiteCardIndex(card), 1));


		let blackFound : BlackCard[] = [];

		for (let i = 0; i < col.black.length; i++) {
			const card = col.black[i];

			if (this.black.includes(card)) {
				blackFound.push(card);
			}
		}

		blackFound.forEach(card => this.black.splice(this.getBlackCardIndex(card), 1)); 

		return true;
	}
 
	static create (data : StoredCards) : CardCollection {
		let col = new CardCollection();

		// TODO: allow there to be only one card in the black and white props

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

	randomIndex
};
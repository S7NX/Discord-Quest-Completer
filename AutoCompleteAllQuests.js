(async function runDiscordQuests() {
	const CONSTANTS = {
		SUPPORTED_TASKS: ['WATCH_VIDEO', 'PLAY_ON_DESKTOP', 'STREAM_ON_DESKTOP', 'PLAY_ACTIVITY', 'WATCH_VIDEO_ON_MOBILE'],
		VIDEO_SPEED: 7,
		HEARTBEAT_INTERVAL_BASE: 30000,
		HEARTBEAT_INTERVAL_VAR: 15000,
		MAX_RETRIES: 3,
		PLAY_ACTIVITY_BASE: 20000,
		PLAY_ACTIVITY_VAR: 10000,
		RATE_LIMIT_BASE_ADD: 1000,
		PID_START: 10000,
	};

	const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

	let _currentPid = CONSTANTS.PID_START;
	const getUniquePid = () => _currentPid++;

	delete window.$;
	let wpRequire;
	try {
		wpRequire = window.webpackChunkdiscord_app.push([[Symbol()], {}, (r) => r]);
		window.webpackChunkdiscord_app.pop();
	} catch (e) {
		console.error("Failed to hook into Discord's webpack. Are you running this in the client?", e);
		return;
	}

	const webpackExports = Object.values(wpRequire.c);

	function getStore(name, extractFn) {
		try {
			const result = extractFn(webpackExports);
			if (!result) throw new Error('Module returned null/undefined');
			return result;
		} catch (e) {
			console.error(`[Error] Failed to initialize ${name}:`, e.message);
			return null;
		}
	}

	const ApplicationStreamingStore = getStore('ApplicationStreamingStore', (mods) => mods.find((x) => x?.exports?.A?.__proto__?.getStreamerActiveStreamMetadata)?.exports?.A);
	const RunningGameStore = getStore('RunningGameStore', (mods) => mods.find((x) => x?.exports?.Ay?.getRunningGames)?.exports?.Ay);
	const QuestsStore = getStore('QuestsStore', (mods) => mods.find((x) => x?.exports?.A?.__proto__?.getQuest)?.exports?.A);
	const ChannelStore = getStore('ChannelStore', (mods) => mods.find((x) => x?.exports?.A?.__proto__?.getAllThreadsForParent)?.exports?.A);
	const GuildChannelStore = getStore('GuildChannelStore', (mods) => mods.find((x) => x?.exports?.Ay?.getSFWDefaultChannel)?.exports?.Ay);
	const FluxDispatcher = getStore('FluxDispatcher', (mods) => mods.find((x) => x?.exports?.h?.__proto__?.flushWaitQueue)?.exports?.h);
	const api = getStore('api', (mods) => mods.find((x) => x?.exports?.Bo?.get)?.exports?.Bo);

	const requiredStores = { ApplicationStreamingStore, RunningGameStore, QuestsStore, FluxDispatcher, api };
	for (const [name, store] of Object.entries(requiredStores)) {
		if (!store) {
			console.error(`Critical dependency missing: ${name}. Aborting.`);
			return;
		}
	}

	if (typeof globalThis.__quest_isApp === 'undefined') {
		globalThis.__quest_isApp = typeof window.DiscordNative !== 'undefined';
	}

	const allQuests = [...(QuestsStore?.quests?.values?.() || [])];

	let quests = allQuests.filter((x) => x?.id !== '1412491570820812933' && !x?.userStatus?.completedAt && x?.config?.expiresAt && new Date(x.config.expiresAt).getTime() > Date.now() && CONSTANTS.SUPPORTED_TASKS.some((y) => Object.keys((x?.config?.taskConfig ?? x?.config?.taskConfigV2)?.tasks || {}).includes(y)));

	if (quests.length === 0) {
		console.log("You don't have any uncompleted quests!");
		return;
	}

	console.log(`Found ${quests.length} quest(s) to enroll and complete.`);

	try {
		await runAllConcurrently(quests);
	} catch (err) {
		console.error('Critical error during overarching quest execution:', err);
	}

	async function runAllConcurrently(quests) {
		await Promise.allSettled(
			quests.map(async (q) => {
				if (!q?.userStatus?.enrolledAt) {
					try {
						const res = await api.post({ url: `/quests/${q.id}/enroll`, body: { location: 0 } });
						if (res?.body) q.userStatus = res.body;
						console.log(`Enrolled in: ${q?.config?.messages?.questName || 'Unknown Quest'}`);
					} catch (e) {
						console.warn(`Failed to enroll in ${q?.config?.messages?.questName || 'Unknown Quest'}:`, e);
					}
				}
			}),
		);

		const originalGetRunningGames = RunningGameStore.getRunningGames;
		const originalGetGameForPID = RunningGameStore.getGameForPID;
		const originalGetStreamer = ApplicationStreamingStore.getStreamerActiveStreamMetadata;

		let activeFakeGames = [];
		let activeStreams = [];

		RunningGameStore.getRunningGames = () => {
			try {
				const real = typeof originalGetRunningGames === 'function' ? originalGetRunningGames.call(RunningGameStore) : [];
				return Array.isArray(real) ? real.concat(activeFakeGames) : activeFakeGames.slice();
			} catch (e) {
				return activeFakeGames.slice();
			}
		};

		RunningGameStore.getGameForPID = (pid) => {
			const fake = activeFakeGames.find((g) => g.pid === pid);
			if (fake) return fake;
			try {
				return typeof originalGetGameForPID === 'function' ? originalGetGameForPID.call(RunningGameStore, pid) : null;
			} catch (e) {
				return null;
			}
		};

		ApplicationStreamingStore.getStreamerActiveStreamMetadata = () => {
			if (activeStreams.length > 0) return activeStreams[0];
			try {
				return typeof originalGetStreamer === 'function' ? originalGetStreamer.call(ApplicationStreamingStore) : null;
			} catch (e) {
				return null;
			}
		};

		try {
			const promises = quests.map((q) =>
				runQuest(q, {
					addFakeGame: (g) => {
						activeFakeGames.push(g);
						FluxDispatcher?.dispatch?.({ type: 'RUNNING_GAMES_CHANGE', removed: [], added: [g], games: [g] });
					},
					removeFakeGame: (g) => {
						activeFakeGames = activeFakeGames.filter((x) => x.pid !== g.pid);
						FluxDispatcher?.dispatch?.({ type: 'RUNNING_GAMES_CHANGE', removed: [g], added: [], games: [] });
					},
					addStream: (s) => {
						activeStreams.push(s);
						FluxDispatcher?.dispatch?.({ type: 'STREAMS_CHANGED', added: [s], removed: [] });
					},
					removeStream: (s) => {
						activeStreams = activeStreams.filter((x) => x.pid !== s.pid);
						FluxDispatcher?.dispatch?.({ type: 'STREAMS_CHANGED', added: [], removed: [s] });
					},
				}),
			);

			const results = await Promise.allSettled(promises);

			console.log('All quests processed.');
			results.forEach((r, i) => {
				const qName = quests[i]?.config?.messages?.questName || 'Unknown Quest';
				if (r.status === 'fulfilled') console.log(`- ${qName}: success`);
				else console.log(`- ${qName}: failed ->`, r.reason);
			});
		} finally {
			if (typeof originalGetRunningGames === 'function') RunningGameStore.getRunningGames = originalGetRunningGames;
			if (typeof originalGetGameForPID === 'function') RunningGameStore.getGameForPID = originalGetGameForPID;
			if (typeof originalGetStreamer === 'function') ApplicationStreamingStore.getStreamerActiveStreamMetadata = originalGetStreamer;
		}
	}

	async function pollHeartbeat(quest, secondsNeeded, initialSecondsDone, progressKey) {
		let secondsDone = initialSecondsDone || 0;
		let retryCount = 0;
		const startTime = Date.now();
		const questName = quest?.config?.messages?.questName || 'Unknown Quest';

		const heartbeatHandler = (data) => {
			try {
				const progress = quest?.config?.configVersion === 1 ? data?.userStatus?.streamProgressSeconds : Math.floor(data?.userStatus?.progress?.[progressKey]?.value ?? 0);

				if (typeof progress === 'number' && progress > secondsDone) {
					secondsDone = progress;
				}
			} catch (e) {
			}
		};

		FluxDispatcher?.subscribe?.('QUESTS_SEND_HEARTBEAT_SUCCESS', heartbeatHandler);

		try {
			while (secondsDone < secondsNeeded) {
				try {
					const res = await api.post({ url: `/quests/${quest.id}/heartbeat`, body: {} });

					const progress = quest?.config?.configVersion === 1 ? res?.body?.userStatus?.streamProgressSeconds : (res?.body?.progress?.[progressKey]?.value ?? secondsDone);

					secondsDone = Math.max(secondsDone, typeof progress === 'number' ? progress : secondsDone);

					const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
					console.log(`[${questName}] Progress: ${secondsDone}/${secondsNeeded} (elapsed: ${elapsedSeconds}s)`);
					retryCount = 0;
				} catch (e) {
					if (e?.status === 429) {
						const retryAfter = (e?.body?.retry_after || 1) * 1000;
						console.warn(`[${questName}] rate limited, waiting ${retryAfter}ms`);
						await delay(retryAfter + Math.random() * CONSTANTS.RATE_LIMIT_BASE_ADD);
						continue;
					}

					retryCount++;
					if (retryCount > CONSTANTS.MAX_RETRIES) {
						console.warn(`[${questName}] heartbeat error after ${retryCount} retries. Halting.`);
						return;
					}
					console.warn(`[${questName}] heartbeat error (retry ${retryCount}/${CONSTANTS.MAX_RETRIES}):`, e?.status || e);
				}

				if (secondsDone >= secondsNeeded) break;

				const jitter = Math.floor(Math.random() * CONSTANTS.HEARTBEAT_INTERVAL_VAR);
				await delay(CONSTANTS.HEARTBEAT_INTERVAL_BASE + jitter);
			}
		} finally {
			FluxDispatcher?.unsubscribe?.('QUESTS_SEND_HEARTBEAT_SUCCESS', heartbeatHandler);
		}
	}

	function getVocalChannelId() {
		try {
			const privateChannels = ChannelStore?.getSortedPrivateChannels?.();
			if (Array.isArray(privateChannels) && privateChannels.length > 0 && privateChannels[0]?.id) {
				return privateChannels[0].id;
			}

			const guilds = GuildChannelStore?.getAllGuilds?.() || {};
			for (const guild of Object.values(guilds)) {
				if (guild && Array.isArray(guild.VOCAL) && guild.VOCAL.length > 0) {
					const channelId = guild.VOCAL[0]?.channel?.id;
					if (channelId) return channelId;
				}
			}
		} catch (e) {
			console.warn('Error looking up voice channel:', e);
		}
		return null;
	}

	async function runQuest(quest, registry) {
		const pid = getUniquePid();
		const questName = quest?.config?.messages?.questName || 'Unknown Quest';
		const taskConfig = quest?.config?.taskConfig ?? quest?.config?.taskConfigV2;

		if (!taskConfig || !taskConfig.tasks) {
			console.log(`Quest ${questName}: missing task configuration — not supported.`);
			return;
		}

		const taskName = CONSTANTS.SUPPORTED_TASKS.find((x) => taskConfig.tasks[x] != null);
		if (!taskName) {
			console.log(`Quest ${questName}: task type not supported — available: ${Object.keys(taskConfig.tasks).join(', ')}`);
			return;
		}

		const taskData = taskConfig.tasks[taskName];
		const applicationId = quest?.config?.application?.id ?? taskData?.applications?.[0]?.id;
		const secondsNeeded = taskData?.target || 0;
		let secondsDone = quest?.userStatus?.progress?.[taskName]?.value ?? 0;

		console.log(`--- Starting Quest: ${questName} (${taskName}) ---`);

		if (taskName === 'WATCH_VIDEO' || taskName === 'WATCH_VIDEO_ON_MOBILE') {
			const speed = CONSTANTS.VIDEO_SPEED;
			let completed = false;

			while (secondsDone < secondsNeeded) {
				const remaining = Math.min(speed, secondsNeeded - secondsDone);
				await delay(remaining * 1000);

				const timestamp = secondsDone + speed;
				try {
					const res = await api.post({
						url: `/quests/${quest.id}/video-progress`,
						body: { timestamp: Math.min(secondsNeeded, timestamp + Math.random()) },
					});
					completed = res?.body?.completed_at != null;
					secondsDone = Math.min(secondsNeeded, timestamp);
					console.log(`[${questName}] video-progress -> ${secondsDone}/${secondsNeeded} (${Math.round((secondsDone / secondsNeeded) * 100)}%)`);
				} catch (e) {
					console.warn(`[${questName}] video-progress error:`, e);
				}

				if (completed || secondsDone >= secondsNeeded) break;
			}

			if (!completed) {
				try {
					await api.post({ url: `/quests/${quest.id}/video-progress`, body: { timestamp: secondsNeeded } });
				} catch (e) {
					console.warn(`[${questName}] final video-progress error:`, e);
				}
			}
			return;
		} else if (taskName === 'PLAY_ON_DESKTOP') {
			if (!globalThis.__quest_isApp) {
				console.log(`Skipping ${questName}: Desktop app required.`);
				return;
			}

			let appData = null;
			try {
				const res = await api.get({ url: `/applications/public?application_ids=${applicationId}` });
				appData = res?.body?.[0];
			} catch (e) {
				console.warn(`[${questName}] Failed to fetch application data:`, e);
			}

			if (!appData) return;

			const safeName = appData?.name || 'game';
			const exeName = appData?.executables?.find((x) => x?.os === 'win32')?.name?.replace('>', '') ?? safeName.replace(/[\/\\:*?"<>|]/g, '') ?? 'game.exe';

			const fakeGame = {
				cmdLine: `C:\\Program Files\\${safeName}\\${exeName}`,
				exeName,
				exePath: `c:/program files/${safeName.toLowerCase()}/${exeName}`,
				hidden: false,
				isLauncher: false,
				id: applicationId,
				name: safeName,
				pid: pid,
				pidPath: [pid],
				processName: safeName,
				start: Date.now(),
			};

			registry.addFakeGame(fakeGame);

			try {
				await pollHeartbeat(quest, secondsNeeded, secondsDone, 'PLAY_ON_DESKTOP');
			} finally {
				registry.removeFakeGame(fakeGame);
			}
		} else if (taskName === 'STREAM_ON_DESKTOP') {
			if (!globalThis.__quest_isApp) {
				console.log(`Skipping ${questName}: Desktop app required.`);
				return;
			}

			const streamMeta = { id: applicationId, pid, sourceName: null };
			registry.addStream(streamMeta);

			try {
				await pollHeartbeat(quest, secondsNeeded, secondsDone, 'STREAM_ON_DESKTOP');
			} finally {
				registry.removeStream(streamMeta);
			}
		} else if (taskName === 'PLAY_ACTIVITY') {
			const channelId = getVocalChannelId();
			if (!channelId) {
				console.warn(`[${questName}] Could not find suitable channel for PLAY_ACTIVITY.`);
				return;
			}

			const streamKey = `call:${channelId}:1`;
			const startTime = Date.now();
			let retryCount = 0;

			while (true) {
				try {
					const res = await api.post({ url: `/quests/${quest.id}/heartbeat`, body: { stream_key: streamKey, terminal: false } });
					const progress = res?.body?.progress?.PLAY_ACTIVITY?.value ?? secondsDone;
					secondsDone = Math.max(secondsDone, progress);
					const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);

					console.log(`[${questName}] Progress: ${secondsDone}/${secondsNeeded} (elapsed: ${elapsedSeconds}s)`);
					retryCount = 0;

					if (secondsDone >= secondsNeeded) {
						try {
							await api.post({ url: `/quests/${quest.id}/heartbeat`, body: { stream_key: streamKey, terminal: true } });
						} catch (err) {
							console.warn(`[${questName}] Error on terminal heartbeat:`, err);
						}
						break;
					}
				} catch (e) {
					if (e?.status === 429) {
						const retryAfter = (e?.body?.retry_after || 1) * 1000;
						console.warn(`[${questName}] rate limited, waiting ${retryAfter}ms`);
						await delay(retryAfter + Math.random() * CONSTANTS.RATE_LIMIT_BASE_ADD);
						continue;
					}
					retryCount++;
					if (retryCount > CONSTANTS.MAX_RETRIES) return;
				}

				const jitter = Math.random() * CONSTANTS.PLAY_ACTIVITY_VAR;
				await delay(CONSTANTS.PLAY_ACTIVITY_BASE + jitter);
			}
		}
	}
})();
